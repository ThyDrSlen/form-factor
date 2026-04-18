import {
  staticWatchSignalTranslator,
  getWatchSignalTranslator,
  setWatchSignalTranslator,
  __resetWatchSignalTranslatorForTests,
  type WatchSignals,
  type WatchSignalTranslator,
} from '@/lib/services/watch-signal-translator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signals(overrides: Partial<WatchSignals> = {}): WatchSignals {
  return {
    hrBpm: 130,
    hrMaxBpm: 185,
    cadenceRpm: 60,
    phaseState: 'working',
    lastRepEccentricSec: 2.0,
    ...overrides,
  };
}

afterEach(() => {
  __resetWatchSignalTranslatorForTests();
});

// ---------------------------------------------------------------------------
// Rule 1 — redlining HR while working
// ---------------------------------------------------------------------------

describe('Rule 1 — working + HR ≥ 90 % of max', () => {
  it('triggers urgent cue when hr/hrMax === 0.90', async () => {
    // 166/185 ≈ 0.897 — just below 90 %; use exact 90 % instead
    const exact = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 185 * 0.9, hrMaxBpm: 185, phaseState: 'working' }),
    );
    expect(exact.tone).toBe('urgent');
    expect(exact.cue).toMatch(/redlining/i);
    expect(exact.source).toBe('static');
  });

  it('triggers urgent cue when hr/hrMax > 0.90', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 180, hrMaxBpm: 185, phaseState: 'working' }),
    );
    expect(result.tone).toBe('urgent');
    expect(result.cue).toMatch(/breathe/i);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — low HR while working (too easy)
// ---------------------------------------------------------------------------

describe('Rule 2 — working + HR < 60 % of max', () => {
  it('triggers chill cue when hr/hrMax < 0.60', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 100, hrMaxBpm: 185, phaseState: 'working' }),
    );
    // 100/185 ≈ 0.54 — below 0.60
    expect(result.tone).toBe('chill');
    expect(result.cue).toMatch(/pick up the pace/i);
    expect(result.source).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — eccentric too fast while working
// ---------------------------------------------------------------------------

describe('Rule 3 — working + eccentric < 0.6 s', () => {
  it('triggers neutral cue when lastRepEccentricSec is between 0 and 0.6', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({
        hrBpm: 140,
        hrMaxBpm: 185,
        phaseState: 'working',
        lastRepEccentricSec: 0.4,
      }),
    );
    // HR ratio 140/185 ≈ 0.757 — between 0.60 and 0.90, so Rule 1 & 2 skip
    expect(result.tone).toBe('neutral');
    expect(result.cue).toMatch(/slow the eccentric/i);
    expect(result.source).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — rest + HR not recovered
// ---------------------------------------------------------------------------

describe('Rule 4 — rest + HR > 75 % of max', () => {
  it('triggers neutral rest cue when HR is still elevated during rest', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 150, hrMaxBpm: 185, phaseState: 'rest' }),
    );
    // 150/185 ≈ 0.81 — above 0.75
    expect(result.tone).toBe('neutral');
    expect(result.cue).toMatch(/stretch rest/i);
    expect(result.source).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — warmup HR still low
// ---------------------------------------------------------------------------

describe('Rule 5 — warmup + HR < 40 % of max', () => {
  it('triggers chill warmup nudge when HR is very low during warmup', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 70, hrMaxBpm: 185, phaseState: 'warmup' }),
    );
    // 70/185 ≈ 0.378 — below 0.40
    expect(result.tone).toBe('chill');
    expect(result.cue).toMatch(/bump the pace/i);
    expect(result.source).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Default — nothing matches
// ---------------------------------------------------------------------------

describe('Default rule', () => {
  it('returns chill default when no rule fires', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({
        hrBpm: 130,
        hrMaxBpm: 185,
        phaseState: 'working',
        lastRepEccentricSec: 2.0,
      }),
    );
    // 130/185 ≈ 0.703 — between 0.60 and 0.90; eccentric is fine; no rule fires
    expect(result.tone).toBe('chill');
    expect(result.cue).toMatch(/nothing flagged/i);
    expect(result.source).toBe('static');
  });
});

// ---------------------------------------------------------------------------
// Rule priority — HR rule beats eccentric rule when both could apply
// ---------------------------------------------------------------------------

describe('Rule priority', () => {
  it('Rule 1 (high HR) wins over Rule 3 (fast eccentric) when both conditions are met', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({
        hrBpm: 180,        // 180/185 ≈ 0.973 → Rule 1
        hrMaxBpm: 185,
        phaseState: 'working',
        lastRepEccentricSec: 0.3, // Also satisfies Rule 3
      }),
    );
    expect(result.tone).toBe('urgent');
    expect(result.cue).toMatch(/redlining/i);
  });
});

// ---------------------------------------------------------------------------
// Invalid hrMaxBpm — skips HR-ratio rules
// ---------------------------------------------------------------------------

describe('Invalid hrMaxBpm', () => {
  it('falls through to default when hrMaxBpm is 0', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 180, hrMaxBpm: 0, phaseState: 'working', lastRepEccentricSec: 2.0 }),
    );
    expect(result.cue).toMatch(/nothing flagged/i);
  });

  it('falls through to default when hrMaxBpm is negative', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 180, hrMaxBpm: -10, phaseState: 'working', lastRepEccentricSec: 2.0 }),
    );
    expect(result.cue).toMatch(/nothing flagged/i);
  });

  it('still applies non-HR Rule 3 when hrMaxBpm is 0 but eccentric is fast', async () => {
    const result = await staticWatchSignalTranslator.translate(
      signals({ hrBpm: 180, hrMaxBpm: 0, phaseState: 'working', lastRepEccentricSec: 0.3 }),
    );
    expect(result.tone).toBe('neutral');
    expect(result.cue).toMatch(/slow the eccentric/i);
  });
});

// ---------------------------------------------------------------------------
// Pluggable runner swap
// ---------------------------------------------------------------------------

describe('Pluggable runner', () => {
  it('getWatchSignalTranslator returns static translator by default', () => {
    expect(getWatchSignalTranslator()).toBe(staticWatchSignalTranslator);
  });

  it('setWatchSignalTranslator swaps the active runner', async () => {
    const customCue = { cue: 'gemma says hi', tone: 'neutral' as const, source: 'gemma-local' as const };
    const mockRunner: WatchSignalTranslator = {
      translate: jest.fn().mockResolvedValue(customCue),
    };

    setWatchSignalTranslator(mockRunner);
    expect(getWatchSignalTranslator()).toBe(mockRunner);

    const result = await getWatchSignalTranslator().translate(signals());
    expect(result.cue).toBe('gemma says hi');
    expect(mockRunner.translate).toHaveBeenCalledTimes(1);
  });

  it('passing null to setWatchSignalTranslator restores static translator', () => {
    const mockRunner: WatchSignalTranslator = {
      translate: jest.fn(),
    };

    setWatchSignalTranslator(mockRunner);
    expect(getWatchSignalTranslator()).toBe(mockRunner);

    setWatchSignalTranslator(null);
    expect(getWatchSignalTranslator()).toBe(staticWatchSignalTranslator);
  });

  it('__resetWatchSignalTranslatorForTests restores static translator', () => {
    const mockRunner: WatchSignalTranslator = {
      translate: jest.fn(),
    };
    setWatchSignalTranslator(mockRunner);
    __resetWatchSignalTranslatorForTests();
    expect(getWatchSignalTranslator()).toBe(staticWatchSignalTranslator);
  });
});
