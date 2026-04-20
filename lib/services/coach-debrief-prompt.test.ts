/**
 * Tests for coach-debrief-prompt: analytics derivations + prompt assembly.
 */

import {
  buildDebriefPrompt,
  computeFqiTrendSlope,
  deriveDebriefAnalytics,
  maxSymmetryOf,
  tempoTrendSlopeOf,
  topFaultOf,
  type DebriefAnalytics,
  type RepAnalytics,
} from './coach-debrief-prompt';

function rep(overrides: Partial<RepAnalytics> = {}): RepAnalytics {
  return { fqi: 0.8, topFault: null, symmetryPct: null, eccentricMs: null, ...overrides };
}

describe('coach-debrief-prompt', () => {
  // -----------------------------------------------------------------
  // computeFqiTrendSlope
  // -----------------------------------------------------------------
  describe('computeFqiTrendSlope', () => {
    it('returns 0 for empty input', () => {
      expect(computeFqiTrendSlope([])).toBe(0);
    });

    it('returns 0 for a single rep (no slope defined)', () => {
      expect(computeFqiTrendSlope([rep({ fqi: 0.8 })])).toBe(0);
    });

    it('returns positive slope for improving series', () => {
      const reps = [rep({ fqi: 0.5 }), rep({ fqi: 0.7 }), rep({ fqi: 0.9 })];
      expect(computeFqiTrendSlope(reps)).toBeGreaterThan(0);
    });

    it('returns negative slope for fatiguing series', () => {
      const reps = [rep({ fqi: 0.9 }), rep({ fqi: 0.7 }), rep({ fqi: 0.5 })];
      expect(computeFqiTrendSlope(reps)).toBeLessThan(0);
    });

    it('returns ~0 for flat series', () => {
      const reps = [rep({ fqi: 0.8 }), rep({ fqi: 0.8 }), rep({ fqi: 0.8 })];
      expect(computeFqiTrendSlope(reps)).toBeCloseTo(0, 5);
    });
  });

  // -----------------------------------------------------------------
  // topFaultOf / maxSymmetryOf / tempoTrendSlopeOf
  // -----------------------------------------------------------------
  describe('topFaultOf', () => {
    it('returns null when no faults are present', () => {
      expect(topFaultOf([rep(), rep()])).toBeNull();
    });

    it('returns the most frequent fault label', () => {
      const reps = [
        rep({ topFault: 'knee_valgus' }),
        rep({ topFault: 'depth_short' }),
        rep({ topFault: 'knee_valgus' }),
      ];
      expect(topFaultOf(reps)).toBe('knee_valgus');
    });

    it('ignores whitespace and empty strings', () => {
      expect(topFaultOf([rep({ topFault: '  ' }), rep({ topFault: '' })])).toBeNull();
    });
  });

  describe('maxSymmetryOf', () => {
    it('returns null when no symmetry values exist', () => {
      expect(maxSymmetryOf([rep(), rep()])).toBeNull();
    });

    it('returns the maximum observed asymmetry', () => {
      const reps = [
        rep({ symmetryPct: 3 }),
        rep({ symmetryPct: 12 }),
        rep({ symmetryPct: 8 }),
      ];
      expect(maxSymmetryOf(reps)).toBe(12);
    });
  });

  describe('tempoTrendSlopeOf', () => {
    it('returns null with <2 tempo samples', () => {
      expect(tempoTrendSlopeOf([rep()])).toBeNull();
    });

    it('returns positive slope for slowing eccentric tempo (classic fatigue)', () => {
      const reps = [
        rep({ eccentricMs: 1500 }),
        rep({ eccentricMs: 1700 }),
        rep({ eccentricMs: 1900 }),
      ];
      const slope = tempoTrendSlopeOf(reps);
      expect(slope).not.toBeNull();
      expect(slope!).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------
  // deriveDebriefAnalytics
  // -----------------------------------------------------------------
  describe('deriveDebriefAnalytics', () => {
    it('handles an empty rep list', () => {
      const a = deriveDebriefAnalytics('sess-1', 'Back Squat', []);
      expect(a.repCount).toBe(0);
      expect(a.avgFqi).toBeNull();
      expect(a.fqiTrendSlope).toBeNull();
      expect(a.topFault).toBeNull();
      expect(a.maxSymmetryPct).toBeNull();
      expect(a.tempoTrendSlope).toBeNull();
    });

    it('handles a single-rep degenerate input', () => {
      const a = deriveDebriefAnalytics('sess-1', 'Deadlift', [rep({ fqi: 0.9 })]);
      expect(a.repCount).toBe(1);
      expect(a.avgFqi).toBe(0.9);
      expect(a.fqiTrendSlope).toBeNull(); // <2 reps -> no trend
    });

    it('aggregates a multi-rep positive series', () => {
      const reps = [
        rep({ fqi: 0.7, topFault: 'depth_short', symmetryPct: 4, eccentricMs: 1400 }),
        rep({ fqi: 0.8, topFault: 'depth_short', symmetryPct: 6, eccentricMs: 1500 }),
        rep({ fqi: 0.9, topFault: null, symmetryPct: 9, eccentricMs: 1600 }),
      ];
      const a = deriveDebriefAnalytics('sess-xyz', 'Pull Up', reps);
      expect(a.repCount).toBe(3);
      expect(a.avgFqi).toBeCloseTo(0.8, 3);
      expect(a.fqiTrendSlope).toBeGreaterThan(0);
      expect(a.topFault).toBe('depth_short');
      expect(a.maxSymmetryPct).toBe(9);
      expect(a.tempoTrendSlope).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------
  // buildDebriefPrompt
  // -----------------------------------------------------------------
  describe('buildDebriefPrompt', () => {
    function analytics(overrides: Partial<DebriefAnalytics> = {}): DebriefAnalytics {
      return {
        sessionId: 'sess-1',
        exerciseName: 'Back Squat',
        repCount: 8,
        avgFqi: 0.82,
        fqiTrendSlope: -0.01,
        topFault: 'depth_short',
        maxSymmetryPct: 11,
        tempoTrendSlope: 35,
        reps: [],
        ...overrides,
      };
    }

    it('emits a [system, user] pair', () => {
      const msgs = buildDebriefPrompt(analytics());
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].role).toBe('user');
    });

    it('embeds exercise, rep count, and avg FQI in the user message', () => {
      const msgs = buildDebriefPrompt(analytics({ exerciseName: 'Bench Press', repCount: 5, avgFqi: 0.91 }));
      expect(msgs[1].content).toMatch(/Bench Press/);
      expect(msgs[1].content).toMatch(/Reps logged: 5/);
      expect(msgs[1].content).toMatch(/Average FQI: 0.91/);
    });

    it('labels the trend direction', () => {
      const improving = buildDebriefPrompt(analytics({ fqiTrendSlope: 0.05 }));
      expect(improving[1].content).toMatch(/improving/);

      const fatiguing = buildDebriefPrompt(analytics({ fqiTrendSlope: -0.05 }));
      expect(fatiguing[1].content).toMatch(/fatiguing/);

      const flat = buildDebriefPrompt(analytics({ fqiTrendSlope: 0.001 }));
      expect(flat[1].content).toMatch(/flat/);
    });

    it('includes the athlete name in the system prompt when provided', () => {
      const msgs = buildDebriefPrompt(analytics(), { athleteName: 'Pat' });
      expect(msgs[0].content).toMatch(/debriefing Pat/);
    });

    it('includes a memory clause when provided', () => {
      const msgs = buildDebriefPrompt(analytics(), {
        memoryClause: 'Athlete trained pulls yesterday at RPE 7.',
      });
      expect(msgs[0].content).toMatch(/Prior context: Athlete trained pulls/);
    });

    it('omits the memory line when absent', () => {
      const msgs = buildDebriefPrompt(analytics());
      expect(msgs[0].content).not.toMatch(/Prior context/);
    });

    it('does not mention FQI trend when slope is null', () => {
      const msgs = buildDebriefPrompt(analytics({ fqiTrendSlope: null }));
      expect(msgs[1].content).not.toMatch(/FQI trend/);
    });

    it('handles the degenerate "no data yet" case cleanly', () => {
      const msgs = buildDebriefPrompt(
        analytics({
          repCount: 0,
          avgFqi: null,
          fqiTrendSlope: null,
          topFault: null,
          maxSymmetryPct: null,
          tempoTrendSlope: null,
        }),
      );
      expect(msgs[1].content).toMatch(/Reps logged: 0/);
      expect(msgs[1].content).not.toMatch(/FQI trend/);
      expect(msgs[1].content).not.toMatch(/fault/);
    });
  });
});
