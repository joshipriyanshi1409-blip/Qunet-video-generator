import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import {
  dnaSignalSchema,
  dnaSuggestionSchema,
  dnaVersionSnapshotSchema,
  type DnaSignal,
  type DnaSignalAppend,
  type DnaSuggestion,
  type DnaSuggestionStatus,
  type DnaVersionSnapshot,
} from '@creatordna/shared';

/**
 * Persistence for the learning loop: signals, suggestions, version snapshots.
 *
 * Deliberately a separate repository from `DnaRepository`. The DNA profile is a
 * single document a creator owns and edits; this is append-heavy history that
 * grows without bound and is read by a background job. Mixing them would put a
 * write-amplifying collection behind the interface the profile read path uses.
 *
 * Firestore is the production store. `createLocalFileDnaLearningRepository` is a
 * development-only fallback so the whole loop runs with no credentials, exactly
 * like the profile repository's.
 */
export interface DnaLearningRepository {
  readonly kind: 'firestore' | 'local-file';

  appendSignal(uid: string, input: DnaSignalAppend): Promise<DnaSignal>;
  /** Most recent first. */
  listSignals(uid: string, limit: number): Promise<DnaSignal[]>;

  putSuggestion(uid: string, suggestion: DnaSuggestion): Promise<DnaSuggestion>;
  listSuggestions(
    uid: string,
    options?: { status?: DnaSuggestionStatus; limit?: number },
  ): Promise<DnaSuggestion[]>;
  /** Returns null when the id is unknown, so a double-accept is a no-op not a 500. */
  updateSuggestion(
    uid: string,
    id: string,
    patch: Partial<Pick<DnaSuggestion, 'status' | 'resolvedAt'>>,
  ): Promise<DnaSuggestion | null>;

  saveVersion(uid: string, snapshot: DnaVersionSnapshot): Promise<DnaVersionSnapshot>;
  /** Newest version first. */
  listVersions(uid: string, limit: number): Promise<DnaVersionSnapshot[]>;

  /**
   * Watermark for the learning loop: when this uid last had a successful run.
   *
   * Signals newer than this are "unseen". It is stored rather than derived from
   * the newest suggestion because a run that legitimately proposes nothing still
   * consumed those signals - deriving it would re-run the model over the same
   * evidence forever.
   */
  getLastRunAt(uid: string): Promise<string | null>;
  setLastRunAt(uid: string, at: string): Promise<void>;

  /**
   * Uids that have recorded at least one signal, most recently active first.
   *
   * The scheduler's discovery step. Bounded, because a real deployment has more
   * creators than one sweep should touch: the next sweep picks up the rest.
   */
  listCandidateUids(limit: number): Promise<string[]>;
}

/** Firestore paths, kept here so the rules file can mirror them. */
export const DNA_SIGNAL_COLLECTION = 'users/{uid}/signals';
export const DNA_SUGGESTION_COLLECTION = 'users/{uid}/suggestions';
export const DNA_VERSION_COLLECTION = 'users/{uid}/versions';

export function createFirestoreDnaLearningRepository(db: Firestore): DnaLearningRepository {
  const signals = (uid: string) => db.collection(`users/${uid}/signals`);
  const suggestions = (uid: string) => db.collection(`users/${uid}/suggestions`);
  const versions = (uid: string) => db.collection(`users/${uid}/versions`);

  return {
    kind: 'firestore',

    async appendSignal(uid, input) {
      const signal = dnaSignalSchema.parse({
        id: signals(uid).doc().id,
        createdAt: new Date().toISOString(),
        ...input,
      });
      await signals(uid).doc(signal.id).set(signal);
      return signal;
    },

    async listSignals(uid, limit) {
      const snapshot = await signals(uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => dnaSignalSchema.parse(doc.data()));
    },

    async putSuggestion(uid, suggestion) {
      await suggestions(uid).doc(suggestion.id).set(suggestion);
      return suggestion;
    },

    async listSuggestions(uid, options) {
      let query = suggestions(uid).orderBy('createdAt', 'desc');
      if (options?.status !== undefined) {
        query = query.where('status', '==', options.status);
      }
      const snapshot = await query.limit(options?.limit ?? 50).get();
      return snapshot.docs.map((doc) => dnaSuggestionSchema.parse(doc.data()));
    },

    async updateSuggestion(uid, id, patch) {
      const ref = suggestions(uid).doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists) return null;
      const current = dnaSuggestionSchema.parse(snapshot.data());
      const next = dnaSuggestionSchema.parse({ ...current, ...patch });
      await ref.set(next);
      return next;
    },

    async saveVersion(uid, snapshot) {
      await versions(uid).doc(String(snapshot.version)).set(snapshot);
      return snapshot;
    },

    async listVersions(uid, limit) {
      const snapshot = await versions(uid).orderBy('version', 'desc').limit(limit).get();
      return snapshot.docs.map((doc) => dnaVersionSnapshotSchema.parse(doc.data()));
    },

    async getLastRunAt(uid) {
      const snapshot = await db.doc(`users/${uid}/learning/state`).get();
      if (!snapshot.exists) return null;
      const raw: Record<string, unknown> | undefined = snapshot.data();
      const at = raw?.lastRunAt;
      return typeof at === 'string' ? at : null;
    },

    async setLastRunAt(uid, at) {
      await db.doc(`users/${uid}/learning/state`).set({ lastRunAt: at }, { merge: true });
    },

    async listCandidateUids(limit) {
      // A collection-group query across every creator's signals, newest first.
      // Firestore requires the composite index this implies; it is declared in
      // `infra/firebase/firestore.indexes.json`.
      const snapshot = await db
        .collectionGroup('signals')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const seen = new Set<string>();
      const uids: string[] = [];
      for (const doc of snapshot.docs) {
        // `users/{uid}/signals/{id}` - the uid is the second path segment.
        const segments = doc.ref.path.split('/');
        const uid = segments[1];
        if (uid === undefined || uid.length === 0 || seen.has(uid)) continue;
        seen.add(uid);
        uids.push(uid);
      }
      return uids;
    },
  };
}

interface LocalFile {
  /**
   * The real uid, stored because the filename is a sanitised version of it and
   * discovery has to hand back the uid the service was called with.
   */
  uid: string;
  signals: DnaSignal[];
  suggestions: DnaSuggestion[];
  versions: DnaVersionSnapshot[];
  lastRunAt: string | null;
}

const EMPTY: LocalFile = {
  uid: '',
  signals: [],
  suggestions: [],
  versions: [],
  lastRunAt: null,
};

/**
 * TODO(phase-9): delete once Firestore (or the emulator) is the only store.
 * Mirrors `createLocalFileDnaRepository`: one JSON file per uid, write-then-rename
 * so a crash never leaves half a record. Capped so a long dev session cannot
 * grow the file without bound.
 */
export function createLocalFileDnaLearningRepository(directory: string): DnaLearningRepository {
  const LIMITS = { signals: 200, suggestions: 100, versions: 50 } as const;

  function fileFor(uid: string): string {
    const safe = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return join(directory, `${safe || 'anonymous'}.json`);
  }

  async function read(uid: string): Promise<LocalFile> {
    try {
      const text = await readFile(fileFor(uid), 'utf8');
      const parsed = JSON.parse(text) as Partial<LocalFile>;
      return {
        uid: parsed.uid ?? '',
        signals: parsed.signals ?? [],
        suggestions: parsed.suggestions ?? [],
        versions: parsed.versions ?? [],
        lastRunAt: parsed.lastRunAt ?? null,
      };
    } catch {
      return { ...EMPTY };
    }
  }

  async function write(uid: string, data: LocalFile): Promise<void> {
    await mkdir(dirname(fileFor(uid)), { recursive: true });
    const target = fileFor(uid);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
    await rename(temporary, target);
  }

  return {
    kind: 'local-file',

    async appendSignal(uid, input) {
      const data = await read(uid);
      const signal = dnaSignalSchema.parse({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        ...input,
      });
      await write(uid, {
        ...data,
        uid,
        signals: [signal, ...data.signals].slice(0, LIMITS.signals),
      });
      return signal;
    },

    async listSignals(uid, limit) {
      const data = await read(uid);
      return data.signals
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },

    async putSuggestion(uid, suggestion) {
      const data = await read(uid);
      const rest = data.suggestions.filter((item) => item.id !== suggestion.id);
      await write(uid, {
        ...data,
        suggestions: [suggestion, ...rest].slice(0, LIMITS.suggestions),
      });
      return suggestion;
    },

    async listSuggestions(uid, options) {
      const data = await read(uid);
      return data.suggestions
        .filter((item) => options?.status === undefined || item.status === options.status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, options?.limit ?? 50);
    },

    async updateSuggestion(uid, id, patch) {
      const data = await read(uid);
      const current = data.suggestions.find((item) => item.id === id);
      if (current === undefined) return null;
      const next = dnaSuggestionSchema.parse({ ...current, ...patch });
      await write(uid, {
        ...data,
        suggestions: data.suggestions.map((item) => (item.id === id ? next : item)),
      });
      return next;
    },

    async saveVersion(uid, snapshot) {
      const data = await read(uid);
      const rest = data.versions.filter((item) => item.version !== snapshot.version);
      await write(uid, {
        ...data,
        versions: [snapshot, ...rest]
          .sort((a, b) => b.version - a.version)
          .slice(0, LIMITS.versions),
      });
      return snapshot;
    },

    async listVersions(uid, limit) {
      const data = await read(uid);
      return data.versions.slice().sort((a, b) => b.version - a.version).slice(0, limit);
    },

    async getLastRunAt(uid) {
      const data = await read(uid);
      return data.lastRunAt;
    },

    async setLastRunAt(uid, at) {
      const data = await read(uid);
      await write(uid, { ...data, lastRunAt: at });
    },

    async listCandidateUids(limit) {
      // No index to lean on, so every file is read. Fine for a dev store with a
      // handful of creators; the Firestore path is what production uses.
      let names: string[];
      try {
        names = await readdir(directory);
      } catch {
        return [];
      }

      const uids: string[] = [];
      for (const name of names) {
        if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
        try {
          const parsed = JSON.parse(await readFile(join(directory, name), 'utf8')) as Partial<LocalFile>;
          if (typeof parsed.uid === 'string' && parsed.uid.length > 0) {
            uids.push(parsed.uid);
          }
        } catch {
          // A half-written or foreign file is skipped rather than failing the sweep.
        }
        if (uids.length >= limit) break;
      }
      return uids;
    },
  };
}
