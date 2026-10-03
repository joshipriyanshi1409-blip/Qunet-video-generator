import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { Storage } from 'firebase-admin/storage';
import { renderAssetSchema, type RenderAsset, type RenderAssetKind } from '@creatordna/shared';

/**
 * Asset storage.
 *
 * Every stage writes a file and records where it went on the job document. That
 * is the whole point of the `assets` array: a retry of a failed stage must not
 * re-run the stages before it, and the only way to know what already exists is
 * for each stage to have left a durable pointer behind.
 *
 * Firebase Storage in production, the local filesystem in development. The
 * interface is one method on purpose - a store that can also delete or list
 * invites a caller to reach for those instead of reading the document.
 */
export interface AssetStore {
  readonly kind: 'local-disk' | 'memory' | 'firebase-storage';
  /** Writes the bytes and returns the asset to record on the job. */
  put(input: PutAssetInput): Promise<RenderAsset>;
  /**
   * Reads an asset back.
   *
   * Not a convenience: a render that resumes from a later stage has to read what
   * the earlier stages produced, and the job document only holds the pointers.
   */
  read(storagePath: string): Promise<Buffer | null>;
}

export interface PutAssetInput {
  /** Owning creator. The first path segment, so a bucket listing stays readable. */
  uid: string;
  jobId: string;
  kind: RenderAssetKind;
  /** File extension without the dot. */
  extension: string;
  mimeType: string;
  body: Buffer;
  /** Present for per-scene clips. */
  sceneIndex?: number;
}

/** `clip-2.mp4` / `voice.wav` - stable, so a retry overwrites rather than adds. */
export function assetFileName(kind: RenderAssetKind, extension: string, sceneIndex?: number): string {
  const suffix = sceneIndex === undefined ? '' : `-${sceneIndex}`;
  return `${kind}${suffix}.${extension}`;
}

/**
 * Storage path for an asset, relative to the bucket root.
 *
 * Shared by every implementation so the local disk, the bucket and the URL all
 * agree on one layout.
 */
export function assetStoragePath(uid: string, jobId: string, fileName: string): string {
  return `renders/${uid}/${jobId}/${fileName}`;
}

/** Local filesystem store. Writes real files under `root`. */
export function createLocalDiskAssetStore(options: {
  root: string;
  /**
   * Prefix the browser should use to load a stored file, e.g.
   * `/api/v1/render-assets`. Omitted means the store records no URL at all -
   * which is honest: a file nobody can fetch is not an asset the UI can show.
   */
  publicBaseUrl?: string;
}): AssetStore {
  const { root } = options;
  const base = options.publicBaseUrl?.replace(/\/+$/, '') ?? '';

  return {
    kind: 'local-disk',

    async put(input) {
      const fileName = assetFileName(input.kind, input.extension, input.sceneIndex);
      const storagePath = assetStoragePath(input.uid, input.jobId, fileName);
      const absolute = normalize(join(root, storagePath));

      // The path is built from ids we control, but a job id reaching the
      // filesystem is still the one place a traversal could sneak in.
      if (absolute.startsWith(normalize(root)) === false) {
        throw new Error(`refusing to write outside the asset root: ${storagePath}`);
      }

      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, input.body);

      return renderAssetSchema.parse({
        kind: input.kind,
        storagePath,
        url: base === '' ? undefined : `${base}/${storagePath.split(sep).join('/')}`,
        sceneIndex: input.sceneIndex,
        mimeType: input.mimeType,
        bytes: input.body.length,
        createdAt: new Date().toISOString(),
      });
    },

    async read(storagePath) {
      const absolute = normalize(join(root, storagePath));
      if (absolute.startsWith(normalize(root)) === false) return null;
      try {
        return await readFile(absolute);
      } catch {
        return null;
      }
    },
  };
}

/** Firebase Storage store. Takes the service, matching `getStorageBucket()`. */
export function createFirebaseStorageAssetStore(storage: Storage): AssetStore {
  const bucket = storage.bucket();

  return {
    kind: 'firebase-storage',

    async put(input) {
      const fileName = assetFileName(input.kind, input.extension, input.sceneIndex);
      const storagePath = assetStoragePath(input.uid, input.jobId, fileName);
      const file = bucket.file(storagePath);

      await file.save(input.body, {
        contentType: input.mimeType,
        resumable: false,
        metadata: { contentType: input.mimeType },
      });

      // A long-lived download URL: the browser needs to load the MP4 straight
      // from storage, and a signed URL that expires mid-session is worse than a
      // public one on a bucket that is already access-controlled by rules.
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      return renderAssetSchema.parse({
        kind: input.kind,
        storagePath,
        url,
        sceneIndex: input.sceneIndex,
        mimeType: input.mimeType,
        bytes: input.body.length,
        createdAt: new Date().toISOString(),
      });
    },

    async read(storagePath) {
      try {
        const [bytes] = await bucket.file(storagePath).download();
        return bytes;
      } catch {
        return null;
      }
    },
  };
}

/** In-memory store for tests: no disk, no bucket, same shape back. */
export function createMemoryAssetStore(): AssetStore & {
  /** Everything written, in write order. */
  readonly written: readonly RenderAsset[];
  /** Bytes by storage path, so a test can assert on the content. */
  bytesFor(storagePath: string): Buffer | undefined;
} {
  const written: RenderAsset[] = [];
  const bodies = new Map<string, Buffer>();

  return {
    kind: 'memory',
    written,
    bytesFor: (storagePath) => bodies.get(storagePath),

    async put(input) {
      const fileName = assetFileName(input.kind, input.extension, input.sceneIndex);
      const storagePath = assetStoragePath(input.uid, input.jobId, fileName);
      bodies.set(storagePath, input.body);
      const asset = renderAssetSchema.parse({
        kind: input.kind,
        storagePath,
        url: `memory://${storagePath}`,
        sceneIndex: input.sceneIndex,
        mimeType: input.mimeType,
        bytes: input.body.length,
        createdAt: new Date().toISOString(),
      });
      written.push(asset);
      return asset;
    },

    async read(storagePath) {
      return bodies.get(storagePath) ?? null;
    },
  };
}
