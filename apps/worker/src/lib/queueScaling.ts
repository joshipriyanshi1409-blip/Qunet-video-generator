/**
 * Queue-depth autoscaling policy.
 *
 * Cloud Run scales on request volume, and a BullMQ worker has none, so the
 * platform cannot size this service on its own. Something has to read the depth
 * of the `render` queue and tell Cloud Run how many instances to run. This file
 * is the decision that thing makes.
 *
 * It is deliberately a pure function. The part that can be wrong - "how many
 * instances does a depth of 40 imply?" - is the part worth testing, and keeping
 * it free of Redis and of the Cloud Run API means it can be tested without
 * either. The runner in `scripts/scaleWorker.ts` is the boring half.
 *
 * The shape is a step function rather than `ceil(depth / concurrency)` because a
 * render is minutes long, not seconds. Dividing by concurrency would size the
 * fleet for the queue as it is *right now*, which lags a burst by exactly the
 * time it takes a render to finish - and then over-provisions while the queue
 * drains. Steps let the fleet grow ahead of the queue and stay put while it
 * empties, which is the cheaper direction to be wrong in.
 */

export interface QueueScalingConfig {
  /** Never run fewer than this, even with an empty queue. */
  minInstances: number;
  /** Never run more than this, whatever the queue says. */
  maxInstances: number;
  /** Renders one instance handles at once (`WORKER_CONCURRENCY`). */
  concurrency: number;
  /** Queue depth at which one more instance is added. */
  stepDepth: number;
  /** Instances added per step. */
  stepInstances: number;
}

export const DEFAULT_QUEUE_SCALING: QueueScalingConfig = {
  minInstances: 2,
  maxInstances: 20,
  concurrency: 4,
  // Eight waiting renders per instance: enough headroom that a burst is absorbed
  // by the queue rather than by a cold start, low enough that an idle fleet is
  // not paying for renders nobody asked for.
  stepDepth: 8,
  stepInstances: 1,
};

export interface ScalingDecision {
  instances: number;
  /**
   * Why, for the log line an operator reads when the fleet looks wrong.
   *
   * `holding` is the interesting one: the queue is empty but renders are still
   * running, so the fleet is sized to finish them rather than cut back to the
   * floor and let a render outlive the instance it started on.
   */
  reason: 'at-floor' | 'holding' | 'at-ceiling' | 'scaled';
  /** The queue depth this decision was made from. */
  depth: number;
}

/**
 * How many worker instances a given queue depth implies.
 *
 * `active` is the count of renders already running. It is *not* subtracted from
 * the depth - BullMQ reports waiting and active separately, so a waiting job is
 * never also an active one. It is used to keep the fleet large enough to finish
 * what it has already started.
 */
export function instancesForDepth(
  depth: number,
  active: number,
  config: QueueScalingConfig = DEFAULT_QUEUE_SCALING,
): ScalingDecision {
  // Queue counts are integers. A negative or fractional depth is a corrupt
  // reading rather than a signal, and truncating it to 0 lands on the floor,
  // which is the safe direction to be wrong in.
  const waiting = Math.max(0, Math.trunc(depth));
  const running = Math.max(0, Math.trunc(active));

  // Renders already running need somewhere to finish. Sizing on the waiting
  // count alone would cut the fleet back underneath a job that is mid-encode
  // the moment the queue empties, which is the one moment it must not.
  const neededForActive = Math.ceil(running / config.concurrency);
  // The ceiling applies on every path. Without the clamp here a large `active`
  // count would push the floor above `maxInstances` and quietly out-scale the
  // budget the operator set.
  const floor = Math.min(config.maxInstances, Math.max(config.minInstances, neededForActive));

  if (waiting === 0) {
    return {
      instances: floor,
      reason: floor > config.minInstances ? 'holding' : 'at-floor',
      depth: waiting,
    };
  }

  const steps = Math.ceil(waiting / config.stepDepth);
  const wanted = floor + steps * config.stepInstances;

  if (wanted >= config.maxInstances) {
    return {
      instances: config.maxInstances,
      reason: 'at-ceiling',
      depth: waiting,
    };
  }

  return { instances: wanted, reason: 'scaled', depth: waiting };
}

/**
 * Whether a new instance count is worth an API call.
 *
 * Cloud Run's `update` is not free and not instant, so a scaler that fires on
 * every poll thrashes the service. Only a change in the decided count is acted
 * on; everything else is a no-op that costs one log line.
 */
export function shouldScale(current: number, wanted: number): boolean {
  return current !== wanted;
}

/** Reads as a single log line, so a scaling history is greppable. */
export function describeDecision(
  decision: ScalingDecision,
  current: number,
  config: QueueScalingConfig,
): string {
  const concurrency = config.concurrency;
  const capacity = decision.instances * concurrency;
  return (
    `render queue depth ${decision.depth}: ` +
    `${current} -> ${decision.instances} instances ` +
    `(${decision.reason}, capacity ${capacity} concurrent renders)`
  );
}
