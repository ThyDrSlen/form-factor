import {
  createCueEngine,
  type CueAudioController,
  type CueCancellationResult,
  type CueRule,
} from '@/lib/fusion/cue-engine';

// =============================================================================
// Helpers
// =============================================================================

const BASE_RULE_ID = 'base';
const HIGH_RULE_ID = 'critical';

function baseRule(overrides: Partial<CueRule> = {}): CueRule {
  return {
    id: BASE_RULE_ID,
    metric: 'leftKnee',
    phases: ['bottom'],
    min: 90,
    max: 100,
    persistMs: 0,
    cooldownMs: 0,
    priority: 3,
    message: 'Low priority',
    channels: ['speech'],
    ...overrides,
  };
}

function makeAudioMock(): CueAudioController & { cancel: jest.Mock } {
  return { cancel: jest.fn() };
}

// =============================================================================
// Priority cancellation semantics
// =============================================================================

describe('cue engine — priority cancellation', () => {
  test('higher-priority emission cancels the currently playing lower-priority cue', () => {
    const audio = makeAudioMock();
    const onCancellation = jest.fn();

    // The low rule watches leftKnee (range 95..105). The high rule watches
    // rightKnee (range 90..100). Using different metrics isolates which
    // frames trigger which rule.
    const low = baseRule({
      id: 'low',
      priority: 3,
      metric: 'leftKnee',
      min: 95,
      max: 105,
      message: 'tempo reminder',
    });
    const high = baseRule({
      id: 'high',
      priority: 1,
      metric: 'rightKnee',
      min: 90,
      max: 100,
      message: 'tracking lost',
    });

    const engine = createCueEngine([low, high], {
      minConfidence: 0.7,
      audio,
      onCancellation,
    });

    // Emit the low-priority cue first. leftKnee=80 violates low; rightKnee=95
    // is inside high's range (90..100) so only low fires.
    const firstEmissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 80, rightKnee: 95 },
    });
    expect(firstEmissions).toHaveLength(1);
    expect(firstEmissions[0]?.ruleId).toBe('low');
    expect(audio.cancel).not.toHaveBeenCalled();

    // 500ms later (well inside the 1500ms playback window), rightKnee=80
    // violates high; leftKnee=100 is inside low's range, so only high fires.
    // The engine should emit 'high' AND cancel the still-playing 'low'.
    const secondEmissions = engine.evaluate({
      timestampMs: 1_500,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 100, rightKnee: 80 },
    });

    expect(secondEmissions).toHaveLength(1);
    expect(secondEmissions[0]?.ruleId).toBe('high');
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(onCancellation).toHaveBeenCalledTimes(1);

    const event = onCancellation.mock.calls[0]?.[0] as CueCancellationResult;
    expect(event.cancelledRuleId).toBe('low');
    expect(event.cancelledPriority).toBe(3);
    expect(event.replacedByRuleId).toBe('high');
    expect(event.replacedByPriority).toBe(1);
    expect(event.timestampMs).toBe(1_500);
  });

  test('lower-priority emission does NOT cancel a playing higher-priority cue', () => {
    const audio = makeAudioMock();
    const onCancellation = jest.fn();

    // Configure the high-priority rule's cooldown so it can only fire once
    // within the test window; after it fires we try to fire low.
    const high = baseRule({
      id: 'high',
      priority: 1,
      min: 90,
      max: 100,
      cooldownMs: 10_000,
      message: 'high priority',
    });
    const low = baseRule({
      id: 'low',
      priority: 3,
      min: 95,
      max: 105,
      cooldownMs: 0,
      message: 'low priority',
    });

    const engine = createCueEngine([high, low], {
      minConfidence: 0.7,
      audio,
      onCancellation,
    });

    // leftKnee=85 violates BOTH — arbitration picks 'high' (priority 1).
    engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 85 },
    });
    // leftKnee=92 is inside high's range (90..100) but outside low's (95..105),
    // so only 'low' fires; high's cooldown also blocks any re-emission.
    const laterEmissions = engine.evaluate({
      timestampMs: 1_400,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 92 },
    });

    expect(laterEmissions).toHaveLength(1);
    expect(laterEmissions[0]?.ruleId).toBe('low');
    // critical: low came in while high is still "playing" — must NOT cancel.
    expect(audio.cancel).not.toHaveBeenCalled();
    expect(onCancellation).not.toHaveBeenCalled();
  });

  test('equal-priority cues do NOT cancel each other (current cue plays to completion)', () => {
    // Documents the chosen behavior: we only preempt on STRICTLY higher
    // priority. Two equally important rules back-to-back should not stutter.
    const audio = makeAudioMock();
    const onCancellation = jest.fn();

    const ruleA = baseRule({ id: 'a', priority: 2, min: 95, max: 105, message: 'A' });
    const ruleB = baseRule({
      id: 'b',
      priority: 2,
      metric: 'rightKnee',
      min: 95,
      max: 105,
      message: 'B',
    });

    const engine = createCueEngine([ruleA, ruleB], {
      minConfidence: 0.7,
      audio,
      onCancellation,
    });

    // First frame: only A violates (leftKnee=80, rightKnee=100 is inside B).
    engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 80, rightKnee: 100 },
    });

    // Second frame: only B violates.
    const second = engine.evaluate({
      timestampMs: 1_400,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 100, rightKnee: 80 },
    });

    expect(second).toHaveLength(1);
    expect(second[0]?.ruleId).toBe('b');
    expect(audio.cancel).not.toHaveBeenCalled();
    expect(onCancellation).not.toHaveBeenCalled();
  });

  test('no cancellation when the playback window has elapsed', () => {
    const audio = makeAudioMock();
    const high = baseRule({ id: 'high', priority: 1, min: 90, max: 100, cooldownMs: 0 });
    const low = baseRule({ id: 'low', priority: 3, min: 95, max: 105, cooldownMs: 0 });

    const engine = createCueEngine([high, low], {
      minConfidence: 0.7,
      audio,
      estimatedPlaybackMs: 500,
    });

    // Fire low (leftKnee=110 is only outside low's 95..105).
    engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 110 },
    });
    // Fire high 2000ms later, past the 500ms window.
    engine.evaluate({
      timestampMs: 3_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 80 },
    });

    expect(audio.cancel).not.toHaveBeenCalled();
  });

  test('engine works without audio controller (optional dependency)', () => {
    const low = baseRule({ id: 'low', priority: 3, min: 95, max: 105, cooldownMs: 0 });
    const high = baseRule({ id: 'high', priority: 1, min: 90, max: 100, cooldownMs: 0 });

    const engine = createCueEngine([low, high], { minConfidence: 0.7 });

    expect(() => {
      engine.evaluate({
        timestampMs: 1_000,
        phase: 'bottom',
        confidence: 0.95,
        metrics: { leftKnee: 80 },
      });
      engine.evaluate({
        timestampMs: 1_300,
        phase: 'bottom',
        confidence: 0.95,
        metrics: { leftKnee: 85 },
      });
    }).not.toThrow();
  });

  // ==========================================================================
  // Wave-29 T5: stacked same-priority rules on a single frame.
  //
  // Covers the tiebreak path at lib/fusion/cue-engine.ts:178-179:
  //   emissions.sort((a, b) => a.priority - b.priority || b.delta - a.delta);
  //   const selected = emissions[0];
  //
  // Scenario: two rules with the SAME priority (=2) watching DIFFERENT
  // metrics both fire on the same frame. The engine must:
  //   1. Emit exactly one cue (no double-speaking).
  //   2. Pick the one with the larger delta (more severe out-of-range value).
  //
  // Extension: when a LOWER-priority cue (=3) is already mid-playback, a
  // higher-priority stacked pair (both =2) should preempt it via
  // maybeCancelLowerPriority at L200-209 → onCancellation fires BEFORE the
  // tiebreak winner emits. Equal-priority does NOT cancel (guarded by the
  // existing 'equal-priority cues do NOT cancel' test above), so the cancel
  // here is purely on the low-priority predecessor, not between the tied pair.
  // ==========================================================================
  test('stacked same-priority rules: exactly one emission, higher-delta wins', () => {
    const audio = makeAudioMock();
    const onCancellation = jest.fn();

    // Both rules priority=2, different metrics. Delta is max(min-value,
    // value-max, 0) per cue-engine.ts:173:
    //   wide_left:   min=97, max=103, value=80 → max(17, -23, 0) = 17
    //   tight_right: min=99, max=101, value=90 → max(9, -11, 0) = 9
    // wide_left wins the tiebreak because its delta is larger.
    const wideLeft = baseRule({
      id: 'wide_left',
      priority: 2,
      metric: 'leftKnee',
      min: 97,
      max: 103,
      cooldownMs: 0,
      persistMs: 0,
      message: 'left track',
    });
    const tightRight = baseRule({
      id: 'tight_right',
      priority: 2,
      metric: 'rightKnee',
      min: 99,
      max: 101,
      cooldownMs: 0,
      persistMs: 0,
      message: 'right track',
    });

    const engine = createCueEngine([wideLeft, tightRight], {
      minConfidence: 0.7,
      audio,
      onCancellation,
    });

    const emissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 80, rightKnee: 90 },
    });

    // Exactly one emission — the higher-delta winner.
    expect(emissions).toHaveLength(1);
    expect(emissions[0]?.ruleId).toBe('wide_left');
    // Cancel is not invoked because nothing was playing yet.
    expect(audio.cancel).not.toHaveBeenCalled();
    expect(onCancellation).not.toHaveBeenCalled();
  });

  test('stacked same-priority pair preempts a playing LOWER-priority cue (onCancellation fires before emit)', () => {
    const audio = makeAudioMock();
    const onCancellation = jest.fn();

    // Playing first: low-priority rule (=3) on leftKnee. Then two
    // same-priority (=2) rules both fire on a later frame; the engine's
    // tiebreak chooses one, and because that winner has strictly higher
    // priority than the currently-playing low, onCancellation MUST fire for
    // the low before the new emission is registered.
    const lowPlaying = baseRule({
      id: 'low_playing',
      priority: 3,
      metric: 'leftKnee',
      min: 95,
      max: 105,
      cooldownMs: 0,
      persistMs: 0,
      message: 'low',
    });
    const tiedA = baseRule({
      id: 'tied_a',
      priority: 2,
      metric: 'leftHip',
      min: 99,
      max: 101,
      cooldownMs: 0,
      persistMs: 0,
      message: 'tied a',
    });
    const tiedB = baseRule({
      id: 'tied_b',
      priority: 2,
      metric: 'rightHip',
      min: 97,
      max: 103,
      cooldownMs: 0,
      persistMs: 0,
      message: 'tied b',
    });

    const engine = createCueEngine([lowPlaying, tiedA, tiedB], {
      minConfidence: 0.7,
      audio,
      onCancellation,
      estimatedPlaybackMs: 1_500,
    });

    // t=1000: only low_playing violates (leftKnee=80, hips inside range).
    const firstEmissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 80, leftHip: 100, rightHip: 100 },
    });
    expect(firstEmissions).toHaveLength(1);
    expect(firstEmissions[0]?.ruleId).toBe('low_playing');
    expect(onCancellation).not.toHaveBeenCalled();

    // t=1200 (inside 1500ms playback window): leftKnee is back in range
    // (so low_playing does not re-fire), but BOTH tied rules fire. Delta is
    // computed per cue-engine.ts:173 as max(min - value, value - max, 0):
    //   tied_a: min=99, max=101, value=92 → max(7, -9, 0) = 7
    //   tied_b: min=97, max=103, value=80 → max(17, -23, 0) = 17
    // tied_b wins the higher-delta tiebreak.
    const secondEmissions = engine.evaluate({
      timestampMs: 1_200,
      phase: 'bottom',
      confidence: 0.95,
      metrics: { leftKnee: 100, leftHip: 92, rightHip: 80 },
    });

    // Exactly one emission — the tiebreak winner.
    expect(secondEmissions).toHaveLength(1);
    expect(secondEmissions[0]?.ruleId).toBe('tied_b');

    // The currently-playing low_playing cue must have been cancelled
    // because the new emission is strictly higher priority (2 < 3).
    expect(audio.cancel).toHaveBeenCalledTimes(1);
    expect(onCancellation).toHaveBeenCalledTimes(1);
    const event = onCancellation.mock.calls[0]?.[0];
    expect(event.cancelledRuleId).toBe('low_playing');
    expect(event.cancelledPriority).toBe(3);
    expect(event.replacedByRuleId).toBe('tied_b');
    expect(event.replacedByPriority).toBe(2);
  });
});
