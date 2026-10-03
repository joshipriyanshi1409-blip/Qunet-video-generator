import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Firestore } from 'firebase-admin/firestore';
import { renderJobSchema, type RenderJob } from '@creatordna/shared';

/**
 * Persistence for render job documents.
 *
 * The document is the source of truth for a render's *state*: which stage it is
 * on, how far through, and which assets already exist. BullMQ owns the queue
 * position; this owns everything a retry needs to skip work.
 *
 * It lives in its own package because **two processes write it**: the API
 * creates the job and re-queues a failed stage, and the worker reports every
 * stage as it runs. Both must agree on the shape *and* on where it is stored, so
 * the store is defined once rather than implemented twice.
 *
 * Firestore in production, a local JSON file in development - the same shape as
 * the DNA and trend repositories, so a deployment without a Firebase project
 * still runs the whole pipeline.
 */
export interface RenderJobRepository {
  readonly kind: 'firestore' | 'local-file';
  /** The document, or null when the job has never been written. */
  get(jobId: string): Promise<RenderJob | null>;
  /** Writes the whole document. The caller owns every field. */
  save(job: RenderJob): Promise<RenderJob>;
  /** Applies a patch and returns the merged document. */
  update(jobId: string, patch: Partial<RenderJob>): Promise<RenderJob>;
  /** Jobs belonging to one creator, newest first. */
  listByUser(uid: string, limit: number): Promise<RenderJob[]>;
}

/** Firestore collection, kept in one place so the rules file can mirror it. */
export const RENDER_JOB_COLLECTION = 'renderJobs';

export function createFirestoreRenderJobRepository(db: Firestore): RenderJobRepository {
  const collection = db.collection(RENDER_JOB_COLLECTION);

  return {
    kind: 'firestore',

    async get(jobId) {
      const snapshot = await collection.doc(jobId).get();
      if (!snapshot.exists) return null;
      return renderJobSchema.parse(snapshot.data());
    },

    async save(job) {
      await collection.doc(job.jobId).set(job);
      return job;
    },

    async update(jobId, patch) {
      const reference = collection.doc(jobId);
      const snapshot = await reference.get();
      if (!snapshot.exists) {
        throw new Error(`render job ${jobId} does not exist`);
      }
      const merged = renderJobSchema.parse({ ...snapshot.data(), ...patch, jobId });
      await reference.set(merged);
      return merged;
    },

    async listByUser(uid, limit) {
      const snapshot = await collection
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => renderJobSchema.parse(doc.data()));
    },
  };
}

/**
 * Development-only local file store.
 *
 * One JSON file holding every job. Deliberately not concurrent-safe and not
 * indexed: it exists so the pipeline runs end to end on a laptop, and it says so
 * loudly on boot (see `apps/api/src/index.ts`).
 */
export function createLocalFileRenderJobRepository(filePath: string): RenderJobRepository {
  async function readAll(): Promise<RenderJob[]> {
    try {
      const text = await readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : [];
      return list.map((entry) => renderJobSchema.parse(entry));
    } catch {
      return [];
    }
  }

  async function writeAll(jobs: readonly RenderJob[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(jobs, null, 2), 'utf8');
    // Rename rather than write in place: a crash mid-write must not leave a
    // truncated file that fails every later read.
    await rename(temporary, filePath);
  }

  return {
    kind: 'local-file',

    async get(jobId) {
      const jobs = await readAll();
      return jobs.find((job) => job.jobId === jobId) ?? null;
    },

    async save(job) {
      const jobs = await readAll();
      const index = jobs.findIndex((entry) => entry.jobId === job.jobId);
      if (index >= 0) jobs[index] = job;
      else jobs.push(job);
      await writeAll(jobs);
      return job;
    },

    async update(jobId, patch) {
      const jobs = await readAll();
      const index = jobs.findIndex((entry) => entry.jobId === jobId);
      if (index < 0) throw new Error(`render job ${jobId} does not exist`);
      const merged = renderJobSchema.parse({ ...jobs[index], ...patch, jobId });
      jobs[index] = merged;
      await writeAll(jobs);
      return merged;
    },

    async listByUser(uid, limit) {
      const jobs = await readAll();
      return jobs
        .filter((job) => job.uid === uid)
        .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
        .slice(0, limit);
    },
  };
}

/**
 * In-memory repository for tests.
 *
 * Same interface, no disk and no Firebase: a test that checks "the retry kept
 * the assets" should not also be testing file IO.
 */
export function createMemoryRenderJobRepository(): RenderJobRepository {
  const jobs = new Map<string, RenderJob>();

  return {
    kind: 'local-file',

    get(jobId) {
      return Promise.resolve(jobs.get(jobId) ?? null);
    },

    save(job) {
      jobs.set(job.jobId, job);
      return Promise.resolve(job);
    },

    update(jobId, patch) {
      const existing = jobs.get(jobId);
      if (existing === undefined) {
        return Promise.reject(new Error(`render job ${jobId} does not exist`));
      }
      const merged = renderJobSchema.parse({ ...existing, ...patch, jobId });
      jobs.set(jobId, merged);
      return Promise.resolve(merged);
    },

    listByUser(uid, limit) {
      return Promise.resolve(
        [...jobs.values()]
          .filter((job) => job.uid === uid)
          .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
          .slice(0, limit),
      );
    },
  };
}

/** Default path for the local-file store, next to the other dev stores. */
export function defaultLocalRenderJobPath(directory: string): string {
  return join(directory, 'render-jobs.json');
}
