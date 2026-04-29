/**
 * Unit coverage for the coach edge-function model dispatch (#557 finding B2).
 *
 * The Deno handler in `./index.ts` duplicates these helpers (can't import
 * a relative `.ts` cleanly across Deno + Bun). Tests assert the pure
 * reference behavior here; any divergence should show up in code review.
 */
import {
  hashUserToBucket,
  parseRolloutPct,
  resolveModelForUser,
} from './model-dispatch';

const PRIMARY = 'gpt-4.1';
const FALLBACK = 'gpt-5.4-mini';

describe('coach model-dispatch', () => {
  describe('parseRolloutPct', () => {
    it('defaults to 100 when env is missing', () => {
      expect(parseRolloutPct(undefined)).toBe(100);
      expect(parseRolloutPct(null)).toBe(100);
      expect(parseRolloutPct('')).toBe(100);
    });

    it('parses valid integers', () => {
      expect(parseRolloutPct('0')).toBe(0);
      expect(parseRolloutPct('50')).toBe(50);
      expect(parseRolloutPct('100')).toBe(100);
    });

    it('floors floats', () => {
      expect(parseRolloutPct('42.9')).toBe(42);
    });

    it('clamps out-of-range values', () => {
      expect(parseRolloutPct('-10')).toBe(0);
      expect(parseRolloutPct('150')).toBe(100);
    });

    it('rejects NaN and infinities back to 100', () => {
      expect(parseRolloutPct('not-a-number')).toBe(100);
      expect(parseRolloutPct('Infinity')).toBe(100);
    });
  });

  describe('hashUserToBucket', () => {
    it('returns a deterministic 0-99 bucket for the same input', () => {
      const a = hashUserToBucket('user-abc');
      const b = hashUserToBucket('user-abc');
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(100);
    });

    it('different user ids tend to land in different buckets', () => {
      const buckets = new Set<number>();
      for (let i = 0; i < 200; i += 1) {
        buckets.add(hashUserToBucket(`user-${i}`));
      }
      // We don't need perfect distribution — just confirmation that the
      // hash isn't collapsing everyone to one bucket.
      expect(buckets.size).toBeGreaterThan(30);
    });

    it('handles empty string input', () => {
      const bucket = hashUserToBucket('');
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    });
  });

  describe('resolveModelForUser', () => {
    it('rollout=100 routes every user to primary', () => {
      for (const uid of ['alice', 'bob', 'carol', 'dave']) {
        expect(
          resolveModelForUser(uid, {
            primaryModel: PRIMARY,
            fallbackModel: FALLBACK,
            rolloutPct: 100,
          }),
        ).toEqual({ model: PRIMARY, path: 'primary' });
      }
    });

    it('rollout=0 routes every user to fallback', () => {
      for (const uid of ['alice', 'bob', 'carol', 'dave']) {
        expect(
          resolveModelForUser(uid, {
            primaryModel: PRIMARY,
            fallbackModel: FALLBACK,
            rolloutPct: 0,
          }),
        ).toEqual({ model: FALLBACK, path: 'fallback' });
      }
    });

    it('same user consistently picks the same path within a given rollout', () => {
      const opts = {
        primaryModel: PRIMARY,
        fallbackModel: FALLBACK,
        rolloutPct: 50,
      };
      const first = resolveModelForUser('user-stable', opts);
      const second = resolveModelForUser('user-stable', opts);
      const third = resolveModelForUser('user-stable', opts);
      expect(first).toEqual(second);
      expect(second).toEqual(third);
    });

    it('rollout=50 splits cohort roughly in half across many users', () => {
      let primary = 0;
      let fallback = 0;
      const opts = {
        primaryModel: PRIMARY,
        fallbackModel: FALLBACK,
        rolloutPct: 50,
      };
      for (let i = 0; i < 1000; i += 1) {
        const res = resolveModelForUser(`user-${i}`, opts);
        if (res.path === 'primary') primary += 1;
        else fallback += 1;
      }
      // Widen the tolerance band to reduce flake risk; the exact
      // distribution depends on hash characteristics.
      expect(primary).toBeGreaterThan(350);
      expect(primary).toBeLessThan(650);
      expect(fallback).toBeGreaterThan(350);
      expect(fallback).toBeLessThan(650);
    });

    it('rollout above 100 is treated as 100', () => {
      expect(
        resolveModelForUser('any-user', {
          primaryModel: PRIMARY,
          fallbackModel: FALLBACK,
          rolloutPct: 150,
        }),
      ).toEqual({ model: PRIMARY, path: 'primary' });
    });

    it('rollout below 0 is treated as 0', () => {
      expect(
        resolveModelForUser('any-user', {
          primaryModel: PRIMARY,
          fallbackModel: FALLBACK,
          rolloutPct: -5,
        }),
      ).toEqual({ model: FALLBACK, path: 'fallback' });
    });
  });
});
