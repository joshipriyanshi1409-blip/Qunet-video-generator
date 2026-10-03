import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUEUE_SCALING,
  describeDecision,
  instancesForDepth,
  shouldScale,
  type QueueScalingConfig,
} from '../lib/queueScaling.js';

/**
 * The autoscaling policy.
 *
 * The properties that matter: it never goes below the floor or above the
 * ceiling, it grows in steps rather than tracking the queue exactly, and it does
 * not count a render already in flight as backlog.
 */

const config: QueueScalingConfig = {
  minInstances: 2,
  maxInstances: 10,
  concurrency: 4,
  stepDepth: 8,
  stepInstances: 1,
};

describe('instancesForDepth', () => {
  it('sits at the floor with an empty queue', () => {
    const decision = instancesForDepth(0, 0, config);
    expect(decision.instances).toBe(2);
    expect(decision.reason).toBe('at-floor');
  });

  it('adds one instance per step of waiting renders', () => {
    expect(instancesForDepth(1, 0, config).instances).toBe(3);
    expect(instancesForDepth(8, 0, config).instances).toBe(3);
    expect(instancesForDepth(9, 0, config).instances).toBe(4);
    expect(instancesForDepth(16, 0, config).instances).toBe(4);
    expect(instancesForDepth(17, 0, config).instances).toBe(5);
  });

  it('never exceeds the ceiling, and says so', () => {
    const decision = instancesForDepth(10_000, 0, config);
    expect(decision.instances).toBe(10);
    expect(decision.reason).toBe('at-ceiling');
  });

  it('never drops below the floor, whatever the reading', () => {
    expect(instancesForDepth(0, 0, config).instances).toBe(config.minInstances);
    expect(instancesForDepth(-50, 0, config).instances).toBe(config.minInstances);
  });

  it('holds enough instances to finish renders already in flight', () => {
    // A fleet of busy instances is not a backlog - the depth is untouched by
    // them - but the queue emptying is exactly when a render must not be cut
    // out from under, so the floor rises to cover what is running.
    expect(instancesForDepth(0, 4, config).instances).toBe(config.minInstances);
    expect(instancesForDepth(0, 4, config).reason).toBe('at-floor');

    // 40 running at concurrency 4 needs 10 instances.
    const busy = instancesForDepth(0, 40, config);
    expect(busy.instances).toBe(10);
    expect(busy.reason).toBe('holding');
  });

  it('does not treat an active render as a waiting one', () => {
    // Depth and active are separate counts in BullMQ; subtracting would
    // double-count and scale forever.
    expect(instancesForDepth(0, 100, config).instances).toBe(config.maxInstances);
    expect(instancesForDepth(1, 100, config).instances).toBe(config.maxInstances);
    // The depth itself is what drives the steps.
    expect(instancesForDepth(8, 0, config).instances).toBe(3);
    expect(instancesForDepth(8, 0, config).reason).toBe('scaled');
  });

  it('treats a negative depth as empty rather than as a scale-down signal', () => {
    const decision = instancesForDepth(-1, 0, config);
    expect(decision.instances).toBe(config.minInstances);
    expect(decision.depth).toBe(0);
  });

  it('truncates a fractional depth, so a corrupt reading lands on the floor', () => {
    // Queue counts are integers; 0.4 is a bad reading, not half a render.
    expect(instancesForDepth(0.4, 0, config).instances).toBe(config.minInstances);
    expect(instancesForDepth(8.9, 0, config).instances).toBe(3);
  });

  it('reports the depth it decided from, for the log', () => {
    expect(instancesForDepth(20, 0, config).depth).toBe(20);
  });

  it('honours a config with a bigger step', () => {
    const wide: QueueScalingConfig = { ...config, stepDepth: 20, stepInstances: 4 };
    expect(instancesForDepth(1, 0, wide).instances).toBe(6);
    expect(instancesForDepth(21, 0, wide).instances).toBe(10);
  });

  it('is monotonic: more waiting renders never mean fewer instances', () => {
    let previous = 0;
    for (let depth = 0; depth <= 120; depth += 1) {
      const instances = instancesForDepth(depth, 0, config).instances;
      expect(instances).toBeGreaterThanOrEqual(previous);
      previous = instances;
    }
  });
});

describe('shouldScale', () => {
  it('acts only on a change', () => {
    expect(shouldScale(2, 3)).toBe(true);
    expect(shouldScale(3, 3)).toBe(false);
  });
});

describe('describeDecision', () => {
  it('carries the depth, the move and the resulting capacity', () => {
    const line = describeDecision(instancesForDepth(20, 0, config), 3, config);

    expect(line).toContain('depth 20');
    // 20 waiting / 8 per step = 3 steps, so 2 + 3 = 5 instances.
    expect(line).toContain('3 -> 5');
    // 5 instances x 4 concurrent renders.
    expect(line).toContain('capacity 20');
  });

  it('says when it is pinned at the ceiling', () => {
    const line = describeDecision(instancesForDepth(999, 0, config), 9, config);
    expect(line).toContain('at-ceiling');
  });
});

describe('the default config', () => {
  it('is internally consistent', () => {
    expect(DEFAULT_QUEUE_SCALING.minInstances).toBeLessThan(DEFAULT_QUEUE_SCALING.maxInstances);
    expect(DEFAULT_QUEUE_SCALING.stepDepth).toBeGreaterThan(0);
    expect(DEFAULT_QUEUE_SCALING.stepInstances).toBeGreaterThan(0);
  });

  it('sizes a modest burst without hitting the ceiling', () => {
    // Ten queued renders is a normal busy afternoon, not an incident.
    const decision = instancesForDepth(10, 0);
    expect(decision.instances).toBeLessThan(DEFAULT_QUEUE_SCALING.maxInstances);
    expect(decision.reason).toBe('scaled');
  });
});
