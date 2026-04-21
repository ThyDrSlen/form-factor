import {
  decideCoachModel,
  type CoachSignals,
  type CoachTaskKind,
  type CoachUserTier,
} from '@/lib/services/coach-model-dispatch';

const TACTICAL_KINDS: CoachTaskKind[] = [
  'form_cue_lookup',
  'rest_calc',
  'encouragement',
  'fault_explainer',
];

const COMPLEX_KINDS: CoachTaskKind[] = [
  'program_design',
  'nutrition_balance',
  'multi_turn_debrief',
  'session_generator',
];

const NO_SIGNALS: CoachSignals = {};

describe('decideCoachModel', () => {
  describe('dispatchDisabled bypass', () => {
    it.each<[CoachTaskKind, CoachUserTier]>([
      ['form_cue_lookup', 'free'],
      ['program_design', 'premium'],
      ['general_chat', 'pro'],
      ['session_generator', 'free'],
    ])('routes every task (%s, tier=%s) to gpt-5.4-mini when dispatchDisabled', (task, tier) => {
      const decision = decideCoachModel(task, NO_SIGNALS, tier, { dispatchDisabled: true });
      expect(decision).toEqual({
        model: 'gpt-5.4-mini',
        reason: 'dispatch_disabled',
        fellBackToCloud: true,
      });
    });

    it('dispatchDisabled wins over forceCloud and high-fault signals', () => {
      const decision = decideCoachModel(
        'form_cue_lookup',
        { faultCount: 10 },
        'premium',
        { dispatchDisabled: true, forceCloud: true },
      );
      expect(decision.reason).toBe('dispatch_disabled');
      expect(decision.model).toBe('gpt-5.4-mini');
    });
  });

  describe('tactical tasks → Gemma', () => {
    it.each(TACTICAL_KINDS)('routes %s to gemma-4-26b-a4b-it for free tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'free');
      expect(decision).toEqual({
        model: 'gemma-4-26b-a4b-it',
        reason: 'tactical_gemma',
        fellBackToCloud: false,
      });
    });

    it.each(TACTICAL_KINDS)('routes %s to gemma-4-31b-it for pro tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'pro');
      expect(decision).toEqual({
        model: 'gemma-4-31b-it',
        reason: 'tactical_gemma',
        fellBackToCloud: false,
      });
    });

    it.each(TACTICAL_KINDS)('routes %s to gemma-4-31b-it for premium tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'premium');
      expect(decision).toEqual({
        model: 'gemma-4-31b-it',
        reason: 'tactical_gemma',
        fellBackToCloud: false,
      });
    });

    it('faultCount below threshold does not upgrade', () => {
      const decision = decideCoachModel('form_cue_lookup', { faultCount: 2 }, 'free');
      expect(decision.model).toBe('gemma-4-26b-a4b-it');
      expect(decision.reason).toBe('tactical_gemma');
    });
  });

  describe('complex tasks → OpenAI', () => {
    it.each(COMPLEX_KINDS)('routes %s to gpt-5.4-mini for free tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'free');
      expect(decision).toEqual({
        model: 'gpt-5.4-mini',
        reason: 'complex_cloud',
        fellBackToCloud: true,
      });
    });

    it.each(COMPLEX_KINDS)('routes %s to gpt-5.4-mini for pro tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'pro');
      expect(decision).toEqual({
        model: 'gpt-5.4-mini',
        reason: 'complex_cloud',
        fellBackToCloud: true,
      });
    });

    it.each(COMPLEX_KINDS)('routes %s to gpt-5.4 for premium tier', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'premium');
      expect(decision).toEqual({
        model: 'gpt-5.4',
        reason: 'complex_cloud',
        fellBackToCloud: true,
      });
    });

    it('forceCloud is a no-op for complex tasks (already cloud)', () => {
      const decision = decideCoachModel(
        'program_design',
        NO_SIGNALS,
        'free',
        { forceCloud: true },
      );
      expect(decision.model).toBe('gpt-5.4-mini');
      expect(decision.reason).toBe('complex_cloud');
    });
  });

  describe('general_chat fallback', () => {
    it.each<CoachUserTier>(['free', 'pro', 'premium'])(
      'general_chat on tier=%s routes to gpt-5.4-mini conservative default',
      (tier) => {
        const decision = decideCoachModel('general_chat', NO_SIGNALS, tier);
        expect(decision).toEqual({
          model: 'gpt-5.4-mini',
          reason: 'general_chat_default',
          fellBackToCloud: true,
        });
      },
    );
  });

  describe('forceCloud override on tactical tasks', () => {
    it.each(TACTICAL_KINDS)('bumps %s to gpt-5.4-mini with force_cloud_override reason', (task) => {
      const decision = decideCoachModel(task, NO_SIGNALS, 'pro', { forceCloud: true });
      expect(decision).toEqual({
        model: 'gpt-5.4-mini',
        reason: 'force_cloud_override',
        fellBackToCloud: true,
      });
    });

    it('forceCloud on tactical wins over the tier that would have picked Gemma', () => {
      const decision = decideCoachModel(
        'encouragement',
        NO_SIGNALS,
        'premium',
        { forceCloud: true },
      );
      expect(decision.model).toBe('gpt-5.4-mini');
      expect(decision.reason).toBe('force_cloud_override');
    });
  });

  describe('high-fault upgrade heuristic', () => {
    it.each(TACTICAL_KINDS)(
      'upgrades tactical task %s when faultCount >= 3',
      (task) => {
        const decision = decideCoachModel(task, { faultCount: 3 }, 'free');
        expect(decision).toEqual({
          model: 'gpt-5.4-mini',
          reason: 'high_fault_upgrade',
          fellBackToCloud: true,
        });
      },
    );

    it('upgrade triggers on much-higher fault counts too', () => {
      const decision = decideCoachModel('form_cue_lookup', { faultCount: 99 }, 'premium');
      expect(decision.reason).toBe('high_fault_upgrade');
      expect(decision.model).toBe('gpt-5.4-mini');
    });

    it('high-fault upgrade takes precedence over forceCloud reason', () => {
      const decision = decideCoachModel(
        'rest_calc',
        { faultCount: 5 },
        'free',
        { forceCloud: true },
      );
      expect(decision.reason).toBe('high_fault_upgrade');
      expect(decision.model).toBe('gpt-5.4-mini');
    });

    it('high-fault heuristic does NOT apply to complex tasks', () => {
      const decision = decideCoachModel('program_design', { faultCount: 10 }, 'free');
      expect(decision.reason).toBe('complex_cloud');
      expect(decision.model).toBe('gpt-5.4-mini');
    });

    // -------------------------------------------------------------------------
    // Gap #7 — high-fault-upgrade + premium tier.
    //
    // The heuristic at coach-model-dispatch.ts:150-156 bumps tactical tasks to
    // `gpt-5.4-mini` regardless of tier. One reading says premium users with
    // high faultCount deserve the best-in-tier model (`gpt-5.4`) since they
    // are paying for it and the session is already degraded. The current
    // implementation does NOT upgrade per tier on the high-fault path — this
    // test pins the existing behavior so any future change is a deliberate
    // choice rather than an accident.
    //
    // If product ever wants tier-aware upgrades on high fault, swap this
    // expectation to `gpt-5.4` and update `tacticalGemmaForTier` + the high
    // -fault branch to mirror `complexCloudForTier`.
    // -------------------------------------------------------------------------
    it('premium + faultCount=5 on tactical task upgrades to gpt-5.4-mini (NOT gpt-5.4)', () => {
      const decision = decideCoachModel(
        'form_cue_lookup',
        { faultCount: 5 },
        'premium',
      );
      // Document: the high-fault upgrade deliberately flattens across tiers.
      expect(decision.model).toBe('gpt-5.4-mini');
      expect(decision.reason).toBe('high_fault_upgrade');
      expect(decision.fellBackToCloud).toBe(true);
    });

    it('pro + faultCount=5 on tactical task also lands on gpt-5.4-mini (tier-flat)', () => {
      const decision = decideCoachModel(
        'form_cue_lookup',
        { faultCount: 5 },
        'pro',
      );
      expect(decision.model).toBe('gpt-5.4-mini');
      expect(decision.reason).toBe('high_fault_upgrade');
    });
  });

  describe('form_vision_check → multimodal Gemma', () => {
    it.each<CoachUserTier>(['free', 'pro', 'premium'])(
      'routes form_vision_check on tier=%s to gemma-4-31b-it by default',
      (tier) => {
        const decision = decideCoachModel('form_vision_check', NO_SIGNALS, tier);
        expect(decision).toEqual({
          model: 'gemma-4-31b-it',
          reason: 'vision_gemma',
          fellBackToCloud: false,
        });
      },
    );

    it('downgrades to gpt-5.4-mini when visionFallbackToCloud is set', () => {
      const decision = decideCoachModel(
        'form_vision_check',
        NO_SIGNALS,
        'pro',
        { visionFallbackToCloud: true },
      );
      expect(decision).toEqual({
        model: 'gpt-5.4-mini',
        reason: 'vision_fallback_cloud',
        fellBackToCloud: true,
      });
    });

    it('dispatchDisabled still beats vision routing (ship-dark guarantee)', () => {
      const decision = decideCoachModel(
        'form_vision_check',
        NO_SIGNALS,
        'premium',
        { dispatchDisabled: true },
      );
      expect(decision.reason).toBe('dispatch_disabled');
      expect(decision.model).toBe('gpt-5.4-mini');
    });

    it('high-fault signal does NOT upgrade form_vision_check (multimodal required)', () => {
      const decision = decideCoachModel(
        'form_vision_check',
        { faultCount: 99 },
        'free',
      );
      expect(decision.model).toBe('gemma-4-31b-it');
      expect(decision.reason).toBe('vision_gemma');
    });

    it('forceCloud does NOT downgrade form_vision_check (gpt-5.4-mini is text-only)', () => {
      const decision = decideCoachModel(
        'form_vision_check',
        NO_SIGNALS,
        'premium',
        { forceCloud: true },
      );
      expect(decision.model).toBe('gemma-4-31b-it');
      expect(decision.reason).toBe('vision_gemma');
    });

    it('visionFallbackToCloud on a non-vision task is a no-op', () => {
      const decision = decideCoachModel(
        'form_cue_lookup',
        NO_SIGNALS,
        'pro',
        { visionFallbackToCloud: true },
      );
      expect(decision.model).toBe('gemma-4-31b-it');
      expect(decision.reason).toBe('tactical_gemma');
    });

    it('visionFallbackToCloud stacks with dispatchDisabled (dispatchDisabled wins)', () => {
      const decision = decideCoachModel(
        'form_vision_check',
        NO_SIGNALS,
        'pro',
        { visionFallbackToCloud: true, dispatchDisabled: true },
      );
      expect(decision.reason).toBe('dispatch_disabled');
    });
  });

  describe('signal/option shape handling', () => {
    it('treats missing faultCount as 0 (no upgrade)', () => {
      const decision = decideCoachModel('form_cue_lookup', {}, 'free');
      expect(decision.reason).toBe('tactical_gemma');
    });

    it('ignores unrelated signal fields', () => {
      const decision = decideCoachModel(
        'encouragement',
        { exerciseKey: 'squat', currentFqi: 72, tokenBudgetRemaining: 1000 },
        'pro',
      );
      expect(decision.model).toBe('gemma-4-31b-it');
      expect(decision.reason).toBe('tactical_gemma');
    });

    it('options argument is optional', () => {
      const decision = decideCoachModel('form_cue_lookup', NO_SIGNALS, 'free');
      expect(decision.model).toBe('gemma-4-26b-a4b-it');
    });
  });
});
