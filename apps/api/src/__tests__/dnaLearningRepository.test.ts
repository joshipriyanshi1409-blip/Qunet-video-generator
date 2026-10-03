import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dnaSignalSchema,
  dnaSuggestionSchema,
  dnaVersionSnapshotSchema,
  type DnaSignalAppend,
} from '@creatordna/shared';
import {
  createFirestoreDnaLearningRepository,
  createLocalFileDnaLearningRepository,
  type DnaLearningRepository,
} from '../lib/dnaLearningRepository.js';

/**
 * Both stores, against one shared behaviour contract.
 *
 * The Firestore path gets an in-memory fake because `listCandidateUids` reads
 * the uid out of `doc.ref.path` - one character off in the split index and the
 * background sweep silently attributes one creator's signals to another, or
 * returns nothing. That parsing is worth pinning down even without credentials.
 */

const append: DnaSignalAppend = {
  kind: 'hook_chosen',
  label: 'Binary search is 8 lines. Everyone writes 30.',
  source: 'hook-lab',
};

const suggestion = dnaSuggestionSchema.parse({
  id: 'sug_1',
  field: 'vocabulary',
  action: 'add',
  value: ['amortized'],
  rationale: 'You kept saying it.',
  evidence: ['sig_1'],
  status: 'pending',
  createdAt: '2026-10-01T10:00:00.000Z',
  promptId: 'dna-learn',
  promptVersion: 1,
  model: 'test-model',
});

const snapshot = dnaVersionSnapshotSchema.parse({
  version: 2,
  savedAt: '2026-10-01T11:00:00.000Z',
  summary: 'Accepted: add 1 vocabulary word',
  dna: {
    niche: 'DSA interview prep',
    tone: ['direct'],
    audience: ['Career switchers'],
    style: 'Whiteboard',
    personality: ['blunt'],
    format: 'whiteboard',
    vocabulary: ['amortized'],
    catchphrases: [],
    dos: [],
    donts: [],
    samplePosts: [],
  },
});

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dna-learning-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe.each([
  ['local-file', () => createLocalFileDnaLearningRepository(directory)],
  ['firestore', () => createFirestoreDnaLearningRepository(fakeFirestore())],
])('%s repository', (_name, build) => {
  let repo: DnaLearningRepository;
  beforeEach(() => {
    repo = build();
  });

  it('appends a signal with a minted id and timestamp', async () => {
    const signal = await repo.appendSignal('creator-a', append);

    // `parse` returns a fresh object, so compare by value.
    expect(dnaSignalSchema.parse(signal)).toEqual(signal);
    expect(signal.id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(signal.createdAt))).toBe(false);
    expect(signal.kind).toBe('hook_chosen');
    expect(signal.label).toBe(append.label);
  });

  it('returns signals newest first', async () => {
    await repo.appendSignal('creator-a', append);
    // A later timestamp, or the ordering is a tie and proves nothing.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.appendSignal('creator-a', { ...append, kind: 'remix_approved' });

    const [first, second] = await repo.listSignals('creator-a', 10);

    expect(second?.kind).toBe('hook_chosen');
    expect(first?.kind).toBe('remix_approved');
    expect(first!.createdAt >= second!.createdAt).toBe(true);
  });

  it('honours the limit', async () => {
    await repo.appendSignal('creator-a', append);
    await repo.appendSignal('creator-a', { ...append, kind: 'remix_approved' });

    expect(await repo.listSignals('creator-a', 1)).toHaveLength(1);
  });

  it('keeps one creator away from another', async () => {
    await repo.appendSignal('creator-a', append);
    await repo.appendSignal('creator-b', { ...append, kind: 'remix_rejected' });

    expect(await repo.listSignals('creator-a', 10)).toHaveLength(1);
    expect(await repo.listSignals('creator-b', 10)).toHaveLength(1);
    expect((await repo.listSignals('creator-b', 10))[0]?.kind).toBe('remix_rejected');
  });

  it('stores and filters suggestions by status', async () => {
    await repo.putSuggestion('creator-a', dnaSuggestionSchema.parse(suggestion));
    await repo.putSuggestion(
      'creator-a',
      dnaSuggestionSchema.parse({ ...suggestion, id: 'sug_2', status: 'rejected' }),
    );

    expect(await repo.listSuggestions('creator-a')).toHaveLength(2);
    expect(await repo.listSuggestions('creator-a', { status: 'pending' })).toHaveLength(1);
    expect(await repo.listSuggestions('creator-a', { status: 'rejected' })).toHaveLength(1);
    expect((await repo.listSuggestions('creator-a', { status: 'pending' }))[0]?.id).toBe('sug_1');
  });

  it('returns null when updating an unknown suggestion, so a double-accept is a no-op', async () => {
    expect(await repo.updateSuggestion('creator-a', 'nope', { status: 'accepted' })).toBeNull();

    await repo.putSuggestion('creator-a', dnaSuggestionSchema.parse(suggestion));
    const accepted = await repo.updateSuggestion('creator-a', 'sug_1', { status: 'accepted' });

    expect(accepted?.status).toBe('accepted');
    // And again: still a no-op, not a crash.
    expect(await repo.updateSuggestion('creator-a', 'sug_1', { status: 'rejected' })).not.toBeNull();
  });

  it('returns versions newest first', async () => {
    await repo.saveVersion('creator-a', snapshot);
    await repo.saveVersion('creator-a', { ...snapshot, version: 3 });

    const [first, second] = await repo.listVersions('creator-a', 10);

    expect(first?.version).toBe(3);
    expect(second?.version).toBe(2);
    expect(await repo.listVersions('creator-a', 1)).toHaveLength(1);
  });

  it('replaces a version with the same number rather than duplicating it', async () => {
    await repo.saveVersion('creator-a', snapshot);
    await repo.saveVersion('creator-a', { ...snapshot, summary: 'Accepted: re-run' });

    const versions = await repo.listVersions('creator-a', 10);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.summary).toBe('Accepted: re-run');
  });

  it('treats the watermark as absent until it is written', async () => {
    expect(await repo.getLastRunAt('creator-a')).toBeNull();

    await repo.setLastRunAt('creator-a', '2026-10-01T12:00:00.000Z');

    expect(await repo.getLastRunAt('creator-a')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('lists only creators that have a signal, each once', async () => {
    await repo.appendSignal('creator-a', append);
    await repo.appendSignal('creator-a', { ...append, kind: 'remix_approved' });
    await repo.appendSignal('creator-b', { ...append, kind: 'remix_rejected' });

    expect(await repo.listCandidateUids(10)).toEqual(['creator-a', 'creator-b']);
  });

  it('caps the candidate list', async () => {
    await repo.appendSignal('creator-a', append);
    await repo.appendSignal('creator-b', append);

    expect(await repo.listCandidateUids(1)).toHaveLength(1);
  });

  it('reports no candidates for a creator that has never signalled', async () => {
    expect(await repo.listCandidateUids(10)).toEqual([]);
  });
});

describe('local-file repository only', () => {
  it('sanitises the uid into a safe filename', async () => {
    const repo = createLocalFileDnaLearningRepository(directory);
    await repo.appendSignal('cre ator/a', append);

    // The uid survives inside the record even though the filename is mangled.
    const uids = await repo.listCandidateUids(10);
    expect(uids).toEqual(['cre ator/a']);
    expect(await repo.listSignals('cre ator/a', 10)).toHaveLength(1);
  });

  it('recovers a record written by a previous process', async () => {
    const first = createLocalFileDnaLearningRepository(directory);
    await first.appendSignal('creator-a', append);

    const second = createLocalFileDnaLearningRepository(directory);
    expect(await second.listSignals('creator-a', 10)).toHaveLength(1);
  });

  it('treats an unparseable file as empty rather than failing the sweep', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(directory, 'broken.json'), '{ not json', 'utf8');

    const repo = createLocalFileDnaLearningRepository(directory);
    await repo.appendSignal('creator-a', append);

    expect(await repo.listSignals('creator-a', 10)).toHaveLength(1);
    expect(await repo.listCandidateUids(10)).toEqual(['creator-a']);
  });

  it('returns no candidates when the directory does not exist yet', async () => {
    const repo = createLocalFileDnaLearningRepository(join(directory, 'missing'));
    expect(await repo.listCandidateUids(10)).toEqual([]);
  });

  it('caps the signal list so a long dev session cannot grow it forever', async () => {
    const repo = createLocalFileDnaLearningRepository(directory);
    for (let index = 0; index < 210; index += 1) {
      await repo.appendSignal('creator-a', { ...append, label: `hook ${index}` });
    }
    // The cap is 200; the newest 200 survive, the oldest is dropped.
    expect(await repo.listSignals('creator-a', 500)).toHaveLength(200);
  });
});

/*
 * A Firestore fake covering exactly the surface the repository uses. It is
 * deliberately not a general implementation: `collection`, `doc`,
 * `collectionGroup`, and the chainable `orderBy`/`where`/`limit`/`get`.
 */
interface FakeRow {
  id: string;
  data: Record<string, unknown>;
  /** The full document path, as Firestore's `ref.path` reports it. */
  path: string;
}

interface FakeQuery {
  orderBy(field: string, direction: 'asc' | 'desc'): FakeQuery;
  where(field: string, op: string, value: unknown): FakeQuery;
  limit(count: number): FakeQuery;
  get(): Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown>; ref: { path: string } }> }>;
}

function fakeFirestore(): Parameters<typeof createFirestoreDnaLearningRepository>[0] {
  /** path -> doc id -> data. The path is the collection, so nesting is free. */
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let counter = 0;

  function rowsOf(collection: string): FakeRow[] {
    return [...(store.get(collection) ?? new Map()).entries()].map(([id, data]) => ({
      id,
      data,
      path: `${collection}/${id}`,
    }));
  }

  function query(start: FakeRow[]): FakeQuery {
    let rows = start;
    const chain: FakeQuery = {
      orderBy(field, direction) {
        rows = rows.slice().sort((a, b) => {
          const left = a.data[field];
          const right = b.data[field];
          const order =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right));
          return direction === 'desc' ? -order : order;
        });
        return chain;
      },
      where(field, _op, value) {
        rows = rows.filter((row) => row.data[field] === value);
        return chain;
      },
      limit(count) {
        rows = rows.slice(0, count);
        return chain;
      },
      async get() {
        return {
          docs: rows.map((row) => ({
            id: row.id,
            data: () => row.data,
            ref: { path: row.path },
          })),
        };
      },
    };
    return chain;
  }

  function collection(path: string): FakeQuery & {
    doc(id?: string): FakeDocRef;
  } {
    return Object.assign(query(rowsOf(path)), {
      doc(id?: string) {
        const docId = id ?? `fake-${(counter += 1)}`;
        return docRef(path, docId);
      },
    });
  }

  function docRef(collection: string, id: string): FakeDocRef {
    return {
      id,
      path: `${collection}/${id}`,
      async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
        const docs = store.get(collection) ?? new Map();
        const previous = docs.get(id) ?? {};
        docs.set(id, options?.merge === true ? { ...previous, ...data } : data);
        store.set(collection, docs);
      },
      async get() {
        const data = store.get(collection)?.get(id);
        return { exists: data !== undefined, data: () => data };
      },
    };
  }

  return {
    collection(path: string) {
      return collection(path);
    },
    collectionGroup(name: string) {
      // Every document whose path ends `/{name}`, wherever it lives.
      const rows: FakeRow[] = [];
      for (const path of store.keys()) {
        if (path.split('/').pop() !== name) continue;
        rows.push(...rowsOf(path));
      }
      return query(rows);
    },
    doc(path: string) {
      const segments = path.split('/');
      const id = segments.pop() as string;
      return docRef(segments.join('/'), id);
    },
  } as unknown as Parameters<typeof createFirestoreDnaLearningRepository>[0];
}

interface FakeDocRef {
  id: string;
  path: string;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
}
