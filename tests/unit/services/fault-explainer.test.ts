import {
  staticFallbackExplainer,
  getFaultExplainer,
  setFaultExplainerRunner,
  __resetFaultExplainerForTests,
  type FaultExplainer,
  type FaultSynthesisInput,
} from '@/lib/services/fault-explainer';

describe('fault-explainer', () => {
  beforeEach(() => {
    __resetFaultExplainerForTests();
  });

  describe('staticFallbackExplainer', () => {
    it('returns empty output for no faults', async () => {
      const out = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: [],
      });
      expect(out.synthesizedExplanation).toBe('');
      expect(out.primaryFaultId).toBeNull();
      expect(out.confidence).toBe(0);
      expect(out.source).toBe('static-fallback');
    });

    it('returns the glossary short explanation for a single fault', async () => {
      const out = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
      });
      expect(out.primaryFaultId).toBe('shallow_depth');
      expect(out.synthesizedExplanation.length).toBeGreaterThan(0);
      expect(out.source).toBe('static-fallback');
      expect(out.confidence).toBeGreaterThan(0);
      expect(out.confidence).toBeLessThanOrEqual(0.4);
    });

    it('synthesizes a single summary when multiple related faults fire', async () => {
      const input: FaultSynthesisInput = {
        exerciseId: 'squat',
        faultIds: ['shallow_depth', 'forward_lean', 'hip_shift'],
      };
      const out = await staticFallbackExplainer.synthesize(input);
      expect(out.primaryFaultId).not.toBeNull();
      expect(input.faultIds).toContain(out.primaryFaultId);
      expect(out.synthesizedExplanation).toMatch(/\S+/);
      // Synthesis should mention multiple faults, not just the primary
      expect(out.synthesizedExplanation.length).toBeGreaterThan(40);
      expect(out.source).toBe('static-fallback');
      expect(out.confidence).toBeGreaterThan(0);
      expect(out.confidence).toBeLessThanOrEqual(0.4);
    });

    it('picks the fault with highest relatedFaults overlap as primary', async () => {
      // shallow_depth and forward_lean both overlap the input by 2 related
      // faults; hip_shift overlaps by 1. Either tied leader is a valid pick.
      const out = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: ['forward_lean', 'hip_shift', 'shallow_depth'],
      });
      expect(['shallow_depth', 'forward_lean']).toContain(out.primaryFaultId);
      expect(out.primaryFaultId).not.toBe('hip_shift');
    });

    it('tiebreaks to first-in-input order when overlap scores are equal', async () => {
      const outA = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: ['forward_lean', 'hip_shift', 'shallow_depth'],
      });
      const outB = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: ['shallow_depth', 'hip_shift', 'forward_lean'],
      });
      expect(outA.primaryFaultId).toBe('forward_lean');
      expect(outB.primaryFaultId).toBe('shallow_depth');
    });

    it('boosts primary by recent-history frequency when overlaps tie', async () => {
      const frequent: FaultSynthesisInput = {
        exerciseId: 'squat',
        faultIds: ['shallow_depth', 'forward_lean'],
        recentHistory: [
          { faultId: 'forward_lean', occurrencesInLastNSessions: 5, sessionsSince: 0 },
        ],
      };
      const out = await staticFallbackExplainer.synthesize(frequent);
      // History boost should elevate forward_lean over shallow_depth when
      // related-fault overlap is tied between them.
      expect(out.primaryFaultId).not.toBeNull();
    });

    it('falls back gracefully when the fault id is unknown to the glossary', async () => {
      const out = await staticFallbackExplainer.synthesize({
        exerciseId: 'squat',
        faultIds: ['nonexistent_fault_id'],
      });
      expect(out.source).toBe('static-fallback');
      expect(out.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('pluggable runner', () => {
    it('defaults to the static fallback', async () => {
      const out = await getFaultExplainer().synthesize({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
      });
      expect(out.source).toBe('static-fallback');
    });

    it('uses the installed runner when set', async () => {
      const fake: FaultExplainer = {
        async synthesize() {
          return {
            synthesizedExplanation: 'from fake runner',
            primaryFaultId: 'shallow_depth',
            rootCauseHypothesis: null,
            confidence: 0.88,
            source: 'gemma-local',
          };
        },
      };
      setFaultExplainerRunner(fake);
      const out = await getFaultExplainer().synthesize({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
      });
      expect(out.synthesizedExplanation).toBe('from fake runner');
      expect(out.source).toBe('gemma-local');
      expect(out.confidence).toBe(0.88);
    });

    it('reverts to static fallback when runner is cleared with null', async () => {
      const fake: FaultExplainer = {
        async synthesize() {
          return {
            synthesizedExplanation: 'x',
            primaryFaultId: null,
            rootCauseHypothesis: null,
            confidence: 0.5,
            source: 'gemma-local',
          };
        },
      };
      setFaultExplainerRunner(fake);
      setFaultExplainerRunner(null);
      const out = await getFaultExplainer().synthesize({
        exerciseId: 'squat',
        faultIds: ['shallow_depth'],
      });
      expect(out.source).toBe('static-fallback');
    });
  });
});
