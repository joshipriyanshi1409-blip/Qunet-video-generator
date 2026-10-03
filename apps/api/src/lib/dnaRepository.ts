import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import {
  creatorDnaSchema,
  dnaHistoryItemSchema,
  type CreatorDna,
  type DnaHistoryItem,
  type DnaHistoryKind,
} from '@creatordna/shared';

/**
 * Persistence for Creator DNA.
 *
 * Firestore is the production store. `createLocalFileDnaRepository` is a
 * **development-only** fallback so the onboarding -> save -> reload flow works
 * without a Firebase project; it is deliberately small and clearly marked.
 */
export interface DnaRepository {
  readonly kind: 'firestore' | 'local-file';
  get(uid: string): Promise<CreatorDna | null>;
  /** Persists the document as given; the caller owns `dnaVersion`. */
  save(uid: string, dna: CreatorDna): Promise<CreatorDna>;
  appendHistory(uid: string, kind: DnaHistoryKind, summary: string): Promise<DnaHistoryItem>;
  /** Most recent first. */
  listHistory(uid: string, limit: number): Promise<DnaHistoryItem[]>;
}

/** Firestore paths, kept in one place so the rules file can mirror them. */
export const DNA_DOC_PATH = 'users/{uid}/dna/profile';
export const DNA_HISTORY_COLLECTION = 'users/{uid}/history';

export function createFirestoreDnaRepository(db: Firestore): DnaRepository {
  function docRef(uid: string) {
    return db.doc(`users/${uid}/dna/profile`);
  }

  function historyRef(uid: string) {
    return db.collection(`users/${uid}/history`);
  }

  return {
    kind: 'firestore',

    async get(uid) {
      const snapshot = await docRef(uid).get();
      if (!snapshot.exists) return null;
      // Firestore's `data()` is `any`; widen it once so the schema is the only
      // thing that decides the shape of what reaches the service.
      const raw: Record<string, unknown> | undefined = snapshot.data();
      const version =
        typeof raw?.dnaVersion === 'number' && Number.isInteger(raw.dnaVersion) ? raw.dnaVersion : 1;
      return creatorDnaSchema.parse({ ...raw, dnaVersion: version });
    },

    async save(uid, dna) {
      await docRef(uid).set({ ...dna, updatedAt: new Date().toISOString() }, { merge: false });
      return dna;
    },

    async appendHistory(uid, kind, summary) {
      const item = dnaHistoryItemSchema.parse({
        id: historyRef(uid).doc().id,
        kind,
        createdAt: new Date().toISOString(),
        summary,
      });
      await historyRef(uid).doc(item.id).set(item);
      return item;
    },

    async listHistory(uid, limit) {
      const snapshot = await historyRef(uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => dnaHistoryItemSchema.parse(doc.data()));
    },
  };
}

interface LocalFile {
  dna: CreatorDna | null;
  history: DnaHistoryItem[];
}

/**
 * TODO(phase-4): delete this once Firestore (or the emulator) is the only store.
 * It exists so `pnpm dev` has a working onboarding flow with no credentials.
 */
export function createLocalFileDnaRepository(directory: string): DnaRepository {
  function fileFor(uid: string): string {
    // uid comes from a verified token; keep it to a safe filename.
    const safe = uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    return join(directory, `${safe || 'anonymous'}.json`);
  }

  async function read(uid: string): Promise<LocalFile> {
    try {
      const text = await readFile(fileFor(uid), 'utf8');
      const parsed = JSON.parse(text) as Partial<LocalFile>;
      return { dna: parsed.dna ?? null, history: parsed.history ?? [] };
    } catch {
      return { dna: null, history: [] };
    }
  }

  async function write(uid: string, data: LocalFile): Promise<void> {
    await mkdir(dirname(fileFor(uid)), { recursive: true });
    const target = fileFor(uid);
    const temporary = `${target}.tmp`;
    // Write-then-rename so a crash never leaves a half-written profile.
    await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
    await rename(temporary, target);
  }

  return {
    kind: 'local-file',

    async get(uid) {
      const data = await read(uid);
      return data.dna;
    },

    async save(uid, dna) {
      const data = await read(uid);
      await write(uid, { ...data, dna });
      return dna;
    },

    async appendHistory(uid, kind, summary) {
      const data = await read(uid);
      const item = dnaHistoryItemSchema.parse({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        createdAt: new Date().toISOString(),
        summary,
      });
      await write(uid, { ...data, history: [item, ...data.history].slice(0, 50) });
      return item;
    },

    async listHistory(uid, limit) {
      const data = await read(uid);
      return data.history
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
  };
}
