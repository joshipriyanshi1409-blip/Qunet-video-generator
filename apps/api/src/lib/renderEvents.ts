/**
 * Render progress events, re-exported from `@creatordna/render`.
 *
 * The API is the *subscriber* half: the worker publishes, this process holds the
 * WebSocket clients, so it re-broadcasts on the per-job channel. The encoder,
 * the decoder and the channel name live with the pipeline so the two processes
 * cannot disagree about the wire shape.
 *
 * This file stays as the import path the rest of the API uses.
 */
export {
  RENDER_EVENTS_CHANNEL,
  createRenderEventBus,
  decodeRenderEvent,
  encodeRenderEvent,
  type RenderEventPublisher,
  type RenderEventSubscriber,
} from '@creatordna/render';
