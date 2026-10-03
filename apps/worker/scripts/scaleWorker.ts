/**
 * Sizes the worker service from the depth of the `render` queue.
 *
 * Cloud Run scales on request volume and a BullMQ worker has none, so this is
 * the missing half. It runs on a schedule (a Cloud Scheduler job hitting a
 * small Cloud Run job, or a cron on a VM) and does one thing: read the queue,
 * decide, and call the Cloud Run API only when the answer changed.
 *
 * The decision itself is `instancesForDepth` in `src/lib/queueScaling.ts` and is
 * pure and tested. This file is the boring half: Redis in, Cloud Run out.
 *
 * It needs no credentials of its own beyond what the worker already has. Redis
 * comes from `REDIS_URL`; the Cloud Run call uses the metadata server, which is
 * present on any GCP compute and needs no key file.
 *
 * Run with:  pnpm --filter @creatordna/worker scale:worker
 * Dry run:   SCALE_DRY_RUN=true pnpm --filter @creatordna/worker scale:worker
 */

import { Redis } from 'ioredis';
import { parseWorkerEnv } from '../src/config/env.js';
import { createWorkerLogger } from '../src/lib/logger.js';
import { createConfig } from '../src/config/index.js';
import {
  DEFAULT_QUEUE_SCALING,
  describeDecision,
  instancesForDepth,
  shouldScale,
} from '../src/lib/queueScaling.js';

/** BullMQ keeps its waiting set under this key, namespaced by the prefix. */
function waitingKey(prefix: string, queue: string): string {
  return `${prefix}:${queue}:wait`;
}
function activeKey(prefix: string, queue: string): string {
  return `${prefix}:${queue}:active`;
}

/** Reads the metadata server's access token. Present on all GCP compute. */
async function metadataToken(): Promise<string> {
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'metadata-flavor': 'google' } },
  );
  if (!response.ok) {
    throw new Error(`the metadata server returned ${response.status} - is this running on GCP?`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== 'string') {
    throw new Error('the metadata server returned no access token');
  }
  return body.access_token;
}

async function main(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const config = createConfig(env);
  const logger = createWorkerLogger(config);

  const queue = 'render';
  const dryRun = process.env.SCALE_DRY_RUN === 'true';

  // A dedicated connection, disconnected at the end: this is a short-lived job
  // and should not hold a pool slot for its whole run. `lazyConnect` so a bad
  // REDIS_URL fails at `connect()` where it can be reported, not at import.
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  redis.on('error', (error: Error) => logger.error({ err: error }, 'redis error'));
  await redis.connect();

  try {
    const [waiting, active] = await Promise.all([
      redis.zcard(waitingKey(env.QUEUE_PREFIX, queue)),
      redis.zcard(activeKey(env.QUEUE_PREFIX, queue)),
    ]);

    const decision = instancesForDepth(waiting, active);
    logger.info(
      { queue, waiting, active, ...decision },
      'render queue depth read',
    );

    const service = process.env.WORKER_SERVICE_NAME ?? 'creatordna-worker';
    const region = process.env.REGION ?? process.env.GOOGLE_CLOUD_REGION ?? 'us-central1';
    const project = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;

    if (project === undefined) {
      logger.warn('PROJECT_ID is not set - nothing to scale, reporting the decision only');
      console.log(describeDecision(decision, decision.instances, DEFAULT_QUEUE_SCALING));
      return;
    }

    // The current instance count, so the decision can be compared against it
    // rather than applied blindly.
    const token = await metadataToken();
    const url =
      `https://run.googleapis.com/v2/projects/${project}/locations/${region}` +
      `/services/${service}`;
    const current = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!current.ok) {
      throw new Error(`reading ${service} returned ${current.status}`);
    }
    const serviceDoc = (await current.json()) as {
      spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
    };
    const annotations = serviceDoc.spec?.template?.metadata?.annotations ?? {};
    const currentInstances = Number(
      annotations['autoscaling.knative.dev/maxScale'] ?? decision.instances,
    );

    if (!shouldScale(currentInstances, decision.instances)) {
      logger.info(
        { current: currentInstances, wanted: decision.instances },
        'worker fleet already correct',
      );
      return;
    }

    const line = describeDecision(decision, currentInstances, DEFAULT_QUEUE_SCALING);
    if (dryRun) {
      logger.info({ dryRun: true }, `would scale: ${line}`);
      console.log(line);
      return;
    }

    // Cloud Run scales by min/max instance annotations, not by an absolute
    // count, so "run N instances" is expressed as min=max=N. That is the
    // honest reading of a queue-depth policy: the fleet is pinned to what the
    // queue needs, and the annotations are the only lever the API exposes.
    const response = await fetch(`${url}?updateMask=spec.template.metadata.annotations`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        spec: {
          template: {
            metadata: {
              annotations: {
                'autoscaling.knative.dev/minScale': String(decision.instances),
                'autoscaling.knative.dev/maxScale': String(decision.instances),
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`scaling ${service} returned ${response.status}: ${await response.text()}`);
    }

    logger.info({ line }, 'worker fleet resized');
    console.log(line);
  } finally {
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\n[scale:worker] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
