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
