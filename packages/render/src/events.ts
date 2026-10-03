import { Redis } from 'ioredis';
import { renderProgressEventSchema, type RenderProgressEvent } from '@creatordna/shared';
import type { Logger } from 'pino';
import type { RedisOptions } from 'ioredis';

/**
 * Render progress events, worker -> API -> browser.
 *
 * The worker cannot reach the API's WebSocket clients: it is another process,
 * possibly another machine. So progress travels over Redis pub/sub - which the
 * pipeline already needs for BullMQ - and the API re-broadcasts it on the `/ws`
 * channel to whoever subscribed to that job.
 * The channel is deliberately the job id: one render, one channel, and a browser
 * can only ever hear about jobs it asked for.
 *
 * This lives beside the pipeline rather than in the API because **the worker is
 * the publisher**. The API only subscribes. Keeping the encoder, the decoder and
 * the channel name in one place means the two processes cannot disagree about
 * the wire shape.
 */
export const RENDER_EVENTS_CHANNEL = 'creatordna:render:events';

export interface RenderEventPublisher {
  /** Publishes one progress event. Never throws: a lost event is a stale bar. */
  publish(event: RenderProgressEvent): Promise<void>;
  close(): Promise<void>;
}

export interface RenderEventSubscriber {
  /** Registers the handler for validated events. */
  onEvent(handler: (event: RenderProgressEvent) => void): void;
  close(): Promise<void>;
}

/** Serialises once, at the edge, so both sides agree on the wire shape. */
export function encodeRenderEvent(event: RenderProgressEvent): string {
  return JSON.stringify(renderProgressEventSchema.parse(event));
}

/** Parses an inbound event, or null when it is not one we understand. */
export function decodeRenderEvent(payload: string): RenderProgressEvent | null {
  try {
    const parsed = renderProgressEventSchema.safeParse(JSON.parse(payload) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface RenderEventBusOptions {
  /** ioredis connection options, already parsed from `REDIS_URL`. */
  redis: RedisOptions;
  logger: Logger;
  /**
   * False builds a bus whose publisher is a no-op.
   *
   * `REDIS_ENABLED=false` is a supported state, not an error: the API still
   * accepts renders and still writes the job document, it just cannot push live
   * progress, and the browser polls `GET /render/:id` instead.
   */
  enabled: boolean;
}

/**
 * Creates the publisher and subscriber.
 *
 * Returns `null` only when the caller passes `enabled: false`; a null bus is the
 * documented "no pub/sub" path rather than an exception.
 */
export function createRenderEventBus(
  options: RenderEventBusOptions,
): { publisher: RenderEventPublisher; subscriber: RenderEventSubscriber } | null {
  const { redis, logger } = options;

  if (!options.enabled) {
    logger.info('render event bus disabled (REDIS_ENABLED=false)');
    return null;
  }

  // ioredis throughout, matching the rest of the app: BullMQ already depends on
  // it, and a second Redis client library would double the connection tuning.
  const publisherClient = new Redis(redis);
  // A subscriber connection cannot issue ordinary commands once subscribed, so
  // it gets its own connection rather than being `duplicate()`d into a corner.
  const subscriberClient = new Redis(redis);

  let handlers: ((event: RenderProgressEvent) => void)[] = [];

  subscriberClient.on('message', (channel: string, payload: string) => {
    if (channel !== RENDER_EVENTS_CHANNEL) return;
    const event = decodeRenderEvent(payload);
    if (event === null) {
      logger.debug({ payload: payload.slice(0, 120) }, 'dropped a malformed render event');
      return;
    }
    for (const handler of handlers) handler(event);
  });

  subscriberClient.on('error', (error: Error) => {
    logger.error({ err: error }, 'render event subscriber error');
  });
  publisherClient.on('error', (error: Error) => {
    logger.error({ err: error }, 'render event publisher error');
  });

  // `ready` gates publishes: ioredis queues commands until the first connection
  // lands, so awaiting it keeps the "publish is best effort" story honest.
  const ready = (async () => {
    await Promise.all([
      new Promise<void>((resolve) => publisherClient.once('ready', () => resolve())),
      new Promise<void>((resolve) => subscriberClient.once('ready', () => resolve())),
    ]);
    await subscriberClient.subscribe(RENDER_EVENTS_CHANNEL);
    logger.info({ channel: RENDER_EVENTS_CHANNEL }, 'render event bus ready');
  })();

  return {
    publisher: {
      async publish(event) {
        try {
          await ready;
          await publisherClient.publish(RENDER_EVENTS_CHANNEL, encodeRenderEvent(event));
        } catch (error) {
          // A dropped progress event must never fail a render that is running
          // fine: the job document still has the truth, and the browser polls.
          logger.debug({ err: error, jobId: event.jobId }, 'render event publish failed');
        }
      },
      async close() {
        await publisherClient.quit().catch(() => publisherClient.disconnect());
      },
    },
    subscriber: {
      onEvent(handler) {
        handlers.push(handler);
      },
      async close() {
        handlers = [];
        await subscriberClient.quit().catch(() => subscriberClient.disconnect());
      },
    },
  };
}
