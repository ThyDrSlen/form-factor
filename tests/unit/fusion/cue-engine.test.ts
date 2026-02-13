import { createCueEngine, type CueRule } from '@/lib/fusion/cue-engine';

const baseRule: CueRule = {
  id: 'knee_depth',
  metric: 'leftKnee',
  phases: ['bottom'],
  min: 85,
  max: 110,
  persistMs: 200,
  cooldownMs: 800,
  priority: 1,
  message: 'Left knee depth out of range',
};

describe('cue engine', () => {
  test('persistence: does not emit before violation window elapses', () => {
    const engine = createCueEngine([baseRule], { minConfidence: 0.7 });

    const first = engine.evaluate({
      timestampMs: 1000,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    const second = engine.evaluate({
      timestampMs: 1100,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    const third = engine.evaluate({
      timestampMs: 1210,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(third[0]?.ruleId).toBe('knee_depth');
  });

  test('cooldown: repeated violation emits once within cooldown interval', () => {
    const engine = createCueEngine([baseRule], { minConfidence: 0.7 });

    engine.evaluate({
      timestampMs: 1000,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    const emitted = engine.evaluate({
      timestampMs: 1210,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    const blockedByCooldown = engine.evaluate({
      timestampMs: 1500,
      phase: 'bottom',
      confidence: 0.9,
      metrics: { leftKnee: 70 },
    });

    expect(emitted).toHaveLength(1);
    expect(blockedByCooldown).toEqual([]);
  });

  test('priority arbitration: emits only highest-priority active violation', () => {
    const highPriorityRule: CueRule = {
      ...baseRule,
      id: 'high_priority',
      min: 90,
      max: 100,
      priority: 1,
      message: 'High priority cue',
      channels: ['speech', 'watch_haptic'],
    };

    const lowPriorityRule: CueRule = {
      ...baseRule,
      id: 'low_priority',
      min: 95,
      max: 105,
      priority: 3,
      message: 'Low priority cue',
      channels: ['ui'],
    };

    const engine = createCueEngine([lowPriorityRule, highPriorityRule], { minConfidence: 0.7 });

    engine.evaluate({
      timestampMs: 1000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 70 },
    });

    const emitted = engine.evaluate({
      timestampMs: 1210,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 70 },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.ruleId).toBe('high_priority');
    expect(emitted[0]?.channels).toEqual(['speech', 'watch_haptic']);
  });

  test('priority arbitration tie-break: higher delta wins when priority equal', () => {
    const tighterRule: CueRule = {
      ...baseRule,
      id: 'tight_range',
      min: 99,
      max: 101,
      priority: 2,
      message: 'Tight range cue',
      channels: ['ui'],
    };

    const widerRule: CueRule = {
      ...baseRule,
      id: 'wide_range',
      min: 80,
      max: 120,
      priority: 2,
      message: 'Wide range cue',
      channels: ['speech'],
    };

    const engine = createCueEngine([widerRule, tighterRule], { minConfidence: 0.7 });

    engine.evaluate({
      timestampMs: 2000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 70 },
    });

    const emitted = engine.evaluate({
      timestampMs: 2210,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 70 },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.ruleId).toBe('tight_range');
  });
});
