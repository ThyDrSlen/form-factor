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

  describe('message rotation', () => {
    const persist = baseRule.persistMs;

    function emitOnce(engine: ReturnType<typeof createCueEngine>, t: number): string | undefined {
      // Clear any lingering violation from a previous emitOnce so this call
      // starts a fresh violation window at t.
      engine.evaluate({
        timestampMs: t - 50,
        phase: 'bottom',
        confidence: 0.9,
        metrics: { leftKnee: 100 },
      });
      engine.evaluate({ timestampMs: t, phase: 'bottom', confidence: 0.9, metrics: { leftKnee: 70 } });
      const result = engine.evaluate({
        timestampMs: t + persist + 10,
        phase: 'bottom',
        confidence: 0.9,
        metrics: { leftKnee: 70 },
      });
      return result[0]?.message;
    }

    test('cycles through messageVariants in order across emissions', () => {
      const rotatingRule: CueRule = {
        ...baseRule,
        messageVariants: ['Brace harder.', 'Drive hips through.', 'Eyes forward.'],
      };
      const engine = createCueEngine([rotatingRule], { minConfidence: 0.7 });

      const first = emitOnce(engine, 1000);
      const second = emitOnce(engine, 5000);
      const third = emitOnce(engine, 9000);

      expect(first).toBe('Brace harder.');
      expect(second).toBe('Drive hips through.');
      expect(third).toBe('Eyes forward.');
    });

    test('wraps around after the last variant', () => {
      const rotatingRule: CueRule = {
        ...baseRule,
        messageVariants: ['A', 'B'],
      };
      const engine = createCueEngine([rotatingRule], { minConfidence: 0.7 });

      const first = emitOnce(engine, 1000);
      const second = emitOnce(engine, 5000);
      const third = emitOnce(engine, 9000);
      const fourth = emitOnce(engine, 13000);

      expect([first, second, third, fourth]).toEqual(['A', 'B', 'A', 'B']);
    });

    test('falls back to message when variants is missing', () => {
      const engine = createCueEngine([baseRule], { minConfidence: 0.7 });
      const emitted = emitOnce(engine, 1000);
      expect(emitted).toBe(baseRule.message);
    });

    test('falls back to message when variants is empty array', () => {
      const rule: CueRule = { ...baseRule, messageVariants: [] };
      const engine = createCueEngine([rule], { minConfidence: 0.7 });
      const emitted = emitOnce(engine, 1000);
      expect(emitted).toBe(baseRule.message);
    });

    test('rotation state is per-rule, not shared across rules', () => {
      const ruleA: CueRule = { ...baseRule, id: 'rule_a', messageVariants: ['A1', 'A2'], priority: 1 };
      const ruleB: CueRule = { ...baseRule, id: 'rule_b', messageVariants: ['B1', 'B2'], priority: 2 };
      // Only rule_a fires because it wins priority when both would violate.
      const engine = createCueEngine([ruleA, ruleB], { minConfidence: 0.7 });

      const first = emitOnce(engine, 1000);
      const second = emitOnce(engine, 5000);
      // rule_b never emits because rule_a keeps winning priority.
      expect([first, second]).toEqual(['A1', 'A2']);
    });

    test('does not advance the index when the rule does not emit', () => {
      const rotatingRule: CueRule = {
        ...baseRule,
        messageVariants: ['first', 'second', 'third'],
      };
      const engine = createCueEngine([rotatingRule], { minConfidence: 0.7 });

      // Evaluate without violating — variantIndex should stay at 0
      engine.evaluate({ timestampMs: 500, phase: 'bottom', confidence: 0.9, metrics: { leftKnee: 100 } });
      engine.evaluate({ timestampMs: 600, phase: 'bottom', confidence: 0.9, metrics: { leftKnee: 100 } });

      const first = emitOnce(engine, 1000);
      expect(first).toBe('first');
    });
  });
});
