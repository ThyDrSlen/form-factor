import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  COACH_MODEL_TIER_KEY,
  DEFAULT_COACH_MODEL_TIER,
  getModelTier,
  isCoachModelTier,
  resetModelTier,
  setModelTier,
  type CoachModelTier,
} from '@/lib/services/coach-model-tier-preference';

describe('coach-model-tier-preference', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('isCoachModelTier', () => {
    it('recognises valid values', () => {
      (['fast', 'balanced', 'smart'] as CoachModelTier[]).forEach((t) => {
        expect(isCoachModelTier(t)).toBe(true);
      });
    });

    it('rejects everything else', () => {
      [null, undefined, '', 'turbo', 42, {}, []].forEach((v) => {
        expect(isCoachModelTier(v)).toBe(false);
      });
    });
  });

  describe('getModelTier', () => {
    it('returns the default when nothing is stored', async () => {
      const tier = await getModelTier();
      expect(tier).toBe(DEFAULT_COACH_MODEL_TIER);
    });

    it('returns the stored tier when valid', async () => {
      await AsyncStorage.setItem(COACH_MODEL_TIER_KEY, 'smart');
      const tier = await getModelTier();
      expect(tier).toBe('smart');
    });

    it('falls back to default on a corrupt stored value', async () => {
      await AsyncStorage.setItem(COACH_MODEL_TIER_KEY, 'not-a-real-tier');
      const tier = await getModelTier();
      expect(tier).toBe(DEFAULT_COACH_MODEL_TIER);
    });

    it('returns default when AsyncStorage throws', async () => {
      const original = AsyncStorage.getItem;
      (AsyncStorage as unknown as { getItem: typeof AsyncStorage.getItem }).getItem =
        jest.fn().mockRejectedValueOnce(new Error('disk full')) as typeof AsyncStorage.getItem;
      try {
        const tier = await getModelTier();
        expect(tier).toBe(DEFAULT_COACH_MODEL_TIER);
      } finally {
        (AsyncStorage as unknown as { getItem: typeof AsyncStorage.getItem }).getItem = original;
      }
    });
  });

  describe('setModelTier', () => {
    it('persists the given tier', async () => {
      await setModelTier('fast');
      const raw = await AsyncStorage.getItem(COACH_MODEL_TIER_KEY);
      expect(raw).toBe('fast');
      expect(await getModelTier()).toBe('fast');
    });

    it('throws on invalid tier input', async () => {
      await expect(
        setModelTier('bogus' as unknown as CoachModelTier),
      ).rejects.toThrow(/Invalid coach model tier/);
    });

    it('swallows storage errors (best-effort persistence)', async () => {
      const original = AsyncStorage.setItem;
      (AsyncStorage as unknown as { setItem: typeof AsyncStorage.setItem }).setItem =
        jest.fn().mockRejectedValueOnce(new Error('disk full')) as typeof AsyncStorage.setItem;
      try {
        await expect(setModelTier('smart')).resolves.toBeUndefined();
      } finally {
        (AsyncStorage as unknown as { setItem: typeof AsyncStorage.setItem }).setItem = original;
      }
    });
  });

  describe('resetModelTier', () => {
    it('removes the stored value', async () => {
      await setModelTier('smart');
      await resetModelTier();
      const raw = await AsyncStorage.getItem(COACH_MODEL_TIER_KEY);
      expect(raw).toBeNull();
      expect(await getModelTier()).toBe(DEFAULT_COACH_MODEL_TIER);
    });

    it('swallows storage errors (best-effort reset)', async () => {
      const original = AsyncStorage.removeItem;
      (AsyncStorage as unknown as { removeItem: typeof AsyncStorage.removeItem }).removeItem =
        jest.fn().mockRejectedValueOnce(new Error('disk full')) as typeof AsyncStorage.removeItem;
      try {
        await expect(resetModelTier()).resolves.toBeUndefined();
      } finally {
        (AsyncStorage as unknown as { removeItem: typeof AsyncStorage.removeItem }).removeItem = original;
      }
    });
  });
});
