/**
 * Render job persistence, re-exported from `@creatordna/render`.
 *
 * The store moved because **two processes write it**: this API creates jobs and
 * re-queues failed stages, and the worker reports every stage as it runs. Both
 * must agree on the shape *and* on where it lives, so the implementation is
 * defined once. This file stays as the import path the rest of the API uses, so
 * nothing above it had to change.
 */
export {
  RENDER_JOB_COLLECTION,
  createFirestoreRenderJobRepository,
  createLocalFileRenderJobRepository,
  createMemoryRenderJobRepository,
  defaultLocalRenderJobPath,
  type RenderJobRepository,
} from '@creatordna/render';
