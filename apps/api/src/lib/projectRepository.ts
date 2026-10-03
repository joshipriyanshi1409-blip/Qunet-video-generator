import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { projectSchema, type Project } from '@creatordna/shared';

/**
 * Project store.
 *
 * A project is one creator's idea carried through remix -> mirror -> improve ->
 * approval. Its `versions` array is the revise loop's memory: every iteration is
 * appended, never overwritten, so "what did I change and why" is answerable
 * after the fact.
 *
 * Three implementations, same as the DNA and trend stores: Firestore when a
 * project is configured, a local JSON file for development, and an in-memory map
 * for tests. The in-memory one is not a cache of the others - it is a different
 * deployment target.
 */

export interface ProjectRepository {
  readonly kind: 'firestore' | 'local-file' | 'memory';
  get(projectId: string, uid: string): Promise<Project | null>;
  /** Inserts a new project. Throws if the id already exists. */
  create(project: Project): Promise<Project>;
  /** Replaces the document. The caller owns the version it is writing. */
  save(project: Project): Promise<Project>;
}

/** Firestore document ids cannot contain `/`, so a uuid is used verbatim. */
export function newProjectId(): string {
  return `proj_${randomUUID()}`;
}

export function createFirestoreProjectRepository(firestore: Firestore): ProjectRepository {
  const collection = firestore.collection('projects');

  return {
    kind: 'firestore',

    async get(projectId, uid) {
      const snapshot = await collection.doc(projectId).get();
      if (!snapshot.exists) return null;
      const project = projectSchema.parse({ id: snapshot.id, ...snapshot.data() });
      // Never leak another creator's project.
      return project.uid === uid ? project : null;
    },

    async create(project) {
      await collection.doc(project.id).create(project);
      return project;
    },

    async save(project) {
      await collection.doc(project.id).set(project);
      return project;
    },
  };
}

export function createLocalFileProjectRepository(file: string): ProjectRepository {
  async function readAll(): Promise<Project[]> {
    try {
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text) as { projects?: unknown };
      const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
      return projects.map((entry) => projectSchema.parse(entry));
    } catch {
      return [];
    }
  }

  async function writeAll(projects: Project[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify({ projects }, null, 2), 'utf8');
    await rename(temporary, file);
  }

  return {
    kind: 'local-file',

    async get(projectId, uid) {
      const found = (await readAll()).find((project) => project.id === projectId);
      return found !== undefined && found.uid === uid ? found : null;
    },

    async create(project) {
      const all = await readAll();
      if (all.some((existing) => existing.id === project.id)) {
        throw new Error(`project "${project.id}" already exists`);
      }
      await writeAll([...all, project]);
      return project;
    },

    async save(project) {
      const all = await readAll();
      const index = all.findIndex((existing) => existing.id === project.id);
      if (index === -1) {
        await writeAll([...all, project]);
      } else {
        all[index] = project;
        await writeAll(all);
      }
      return project;
    },
  };
}

/** Test/deployment target with no persistence at all. */
export function createMemoryProjectRepository(): ProjectRepository {
  const stored = new Map<string, Project>();

  return {
    kind: 'memory',

    get(projectId, uid) {
      const found = stored.get(projectId);
      return Promise.resolve(found !== undefined && found.uid === uid ? found : null);
    },

    create(project) {
      if (stored.has(project.id)) {
        return Promise.reject(new Error(`project "${project.id}" already exists`));
      }
      stored.set(project.id, project);
      return Promise.resolve(project);
    },

    save(project) {
      stored.set(project.id, project);
      return Promise.resolve(project);
    },
  };
}
