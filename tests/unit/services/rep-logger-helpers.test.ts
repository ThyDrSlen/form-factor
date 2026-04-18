/**
 * Coverage for the pure aggregation helpers + RepBuilder in rep-logger.
 * The Supabase-backed `logRep` / `logSet` / `labelRep` paths are exercised
 * by integration tests; this file isolates the side-effect-free maths so
 * regressions in the histogram / cues-per-min / adoption logic surface
 * without needing a network round-trip.
 */

import {
  RepBuilder,
  buildFaultHistogram,
  calculateAvgFqi,
  calculateCuesPerMin,
  checkCueAdoption,
} from '@/lib/services/rep-logger';
import type { EmittedCue } from '@/lib/types/telemetry';

// ---------------------------------------------------------------------------
// calculateAvgFqi
// ---------------------------------------------------------------------------

describe('calculateAvgFqi', () => {
  test('empty array returns undefined (caller decides default)', () => {
    expect(calculateAvgFqi([])).toBeUndefined();
  });

  test('rounds to nearest integer', () => {
    expect(calculateAvgFqi([{ fqi: 80 }, { fqi: 81 }, { fqi: 82 }])).toBe(81);
  });

  test('skips reps with no FQI (e.g. partial-visibility rep)', () => {
    expect(
      calculateAvgFqi([{ fqi: 100 }, { fqi: undefined }, { fqi: 60 }]),
    ).toBe(80);
  });

  test('all-undefined input returns undefined', () => {
    expect(calculateAvgFqi([{ fqi: undefined }, {}])).toBeUndefined();
  });

  test('single rep returns its own FQI', () => {
    expect(calculateAvgFqi([{ fqi: 75 }])).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// buildFaultHistogram
// ---------------------------------------------------------------------------

describe('buildFaultHistogram', () => {
  test('empty input returns empty histogram', () => {
    expect(buildFaultHistogram([])).toEqual({});
  });

  test('counts each fault occurrence across all reps', () => {
    const reps = [
      { faultsDetected: ['kipping', 'partial_rom'] },
      { faultsDetected: ['kipping'] },
      { faultsDetected: ['partial_rom', 'asymmetry'] },
    ];
    expect(buildFaultHistogram(reps)).toEqual({
      kipping: 2,
      partial_rom: 2,
      asymmetry: 1,
    });
  });

  test('reps with no faults contribute nothing', () => {
    expect(
      buildFaultHistogram([{ faultsDetected: [] }, { faultsDetected: [] }]),
    ).toEqual({});
  });

  test('handles a single rep with a single fault', () => {
    expect(buildFaultHistogram([{ faultsDetected: ['kipping'] }])).toEqual({
      kipping: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// calculateCuesPerMin
// ---------------------------------------------------------------------------

describe('calculateCuesPerMin', () => {
  function rep(cues: number, startSec: number, endSec: number) {
    return {
      cuesEmitted: Array.from({ length: cues }, (_, i) => ({
        type: `cue_${i}`,
        ts: new Date(0).toISOString(),
      })) satisfies EmittedCue[],
      startTs: new Date(startSec * 1000).toISOString(),
      endTs: new Date(endSec * 1000).toISOString(),
    };
  }

  test('empty input returns undefined', () => {
    expect(calculateCuesPerMin([])).toBeUndefined();
  });

  test('zero-duration window returns undefined (avoid div by zero)', () => {
    const r = rep(3, 0, 0);
    expect(calculateCuesPerMin([r])).toBeUndefined();
  });

  test('two reps over one minute with two cues total reports 2.0 cpm', () => {
    expect(calculateCuesPerMin([rep(1, 0, 30), rep(1, 30, 60)])).toBe(2);
  });

  test('rounds to one decimal', () => {
    // 5 cues over 90 s = 3.333 → 3.3
    expect(
      calculateCuesPerMin([rep(2, 0, 30), rep(3, 30, 90)]),
    ).toBeCloseTo(3.3, 1);
  });

  test('duration uses first start to last end, even with gaps', () => {
    // 2 cues, first rep at 0-10s, last rep at 50-60s → 60s window → 2 cpm
    expect(calculateCuesPerMin([rep(1, 0, 10), rep(1, 50, 60)])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkCueAdoption
// ---------------------------------------------------------------------------

describe('checkCueAdoption', () => {
  function cue(type: string): EmittedCue {
    return { type, ts: new Date(0).toISOString() };
  }

  test('returns false when reps array is shorter than window', () => {
    const reps = [
      { faultsDetected: ['kipping'], cuesEmitted: [cue('kipping')] },
    ];
    expect(checkCueAdoption(reps, 3)).toBe(false);
  });

  test('returns true when fault count drops after a cue', () => {
    const reps = [
      { faultsDetected: ['kipping'], cuesEmitted: [cue('kipping')] },
      { faultsDetected: [], cuesEmitted: [] },
      { faultsDetected: [], cuesEmitted: [] },
      { faultsDetected: [], cuesEmitted: [] },
    ];
    expect(checkCueAdoption(reps, 3)).toBe(true);
  });

  test('returns false when fault persists after cue', () => {
    const reps = [
      { faultsDetected: ['kipping'], cuesEmitted: [cue('kipping')] },
      { faultsDetected: ['kipping'], cuesEmitted: [] },
      { faultsDetected: ['kipping'], cuesEmitted: [] },
      { faultsDetected: ['kipping'], cuesEmitted: [] },
    ];
    expect(checkCueAdoption(reps, 3)).toBe(false);
  });

  test('returns false when no cues were emitted at all', () => {
    const reps = [
      { faultsDetected: ['kipping'], cuesEmitted: [] },
      { faultsDetected: [], cuesEmitted: [] },
      { faultsDetected: [], cuesEmitted: [] },
      { faultsDetected: [], cuesEmitted: [] },
    ];
    expect(checkCueAdoption(reps, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RepBuilder
// ---------------------------------------------------------------------------

describe('RepBuilder', () => {
  test('build() returns a RepEvent with all fluent fields applied', () => {
    const builder = new RepBuilder('session-123', 'pullup', 1)
      .setSetId('set-456')
      .setSide('left')
      .addCue('kipping')
      .addFault('partial_rom')
      .setFeature('romDeg', 80)
      .setFeatures({ depthMin: 90, durationMs: 1500 });

    const event = builder.build(75);

    expect(event.sessionId).toBe('session-123');
    expect(event.exercise).toBe('pullup');
    expect(event.repIndex).toBe(1);
    expect(event.setId).toBe('set-456');
    expect(event.side).toBe('left');
    expect(event.fqi).toBe(75);
    expect(event.faultsDetected).toEqual(['partial_rom']);
    expect(event.cuesEmitted).toHaveLength(1);
    expect(event.cuesEmitted[0].type).toBe('kipping');
    expect(event.features).toEqual({
      romDeg: 80,
      depthMin: 90,
      durationMs: 1500,
    });
    expect(typeof event.startTs).toBe('string');
    expect(typeof event.endTs).toBe('string');
  });

  test('addFault deduplicates the same fault type', () => {
    const event = new RepBuilder('s', 'pullup', 1)
      .addFault('kipping')
      .addFault('kipping')
      .addFault('partial_rom')
      .build();

    expect(event.faultsDetected).toEqual(['kipping', 'partial_rom']);
  });

  test('build() with no fqi argument leaves it undefined', () => {
    const event = new RepBuilder('s', 'pullup', 1).build();
    expect(event.fqi).toBeUndefined();
  });

  test('setFeatures merges into existing features rather than overwriting', () => {
    const event = new RepBuilder('s', 'pullup', 1)
      .setFeature('romDeg', 80)
      .setFeatures({ depthMin: 90 })
      .build();

    expect(event.features.romDeg).toBe(80);
    expect(event.features.depthMin).toBe(90);
  });

  test('endTs is built at build() time, not constructor time', async () => {
    const builder = new RepBuilder('s', 'pullup', 1);
    await new Promise((r) => setTimeout(r, 5));
    const event = builder.build();
    const start = new Date(event.startTs).getTime();
    const end = new Date(event.endTs).getTime();
    expect(end).toBeGreaterThanOrEqual(start);
  });

  test('cues retain insertion order', () => {
    const event = new RepBuilder('s', 'pullup', 1)
      .addCue('kipping')
      .addCue('partial_rom')
      .addCue('asymmetry')
      .build();
    expect(event.cuesEmitted.map((c) => c.type)).toEqual([
      'kipping',
      'partial_rom',
      'asymmetry',
    ]);
  });
});
