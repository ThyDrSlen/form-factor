import {
  getCachedTip,
  getOfflineFallback,
  listCachedKeys,
} from '@/lib/services/coach-cache';

describe('coach-cache', () => {
  describe('getCachedTip', () => {
    test('returns a tip for a known fault id', () => {
      const tip = getCachedTip('squat-knee-cave');
      expect(tip).not.toBeNull();
      expect(tip?.text.length).toBeGreaterThan(20);
    });

    test('returns a tip for a known exercise slug', () => {
      const tip = getCachedTip('squat');
      expect(tip).not.toBeNull();
      expect(tip?.text).toMatch(/squat/i);
    });

    test('is case-insensitive and trims whitespace', () => {
      const a = getCachedTip('  PULLUP-KIP  ');
      const b = getCachedTip('pullup-kip');
      expect(a).toEqual(b);
    });

    test('returns null for unknown key (no throw)', () => {
      expect(getCachedTip('not-a-real-key')).toBeNull();
      expect(getCachedTip('')).toBeNull();
    });

    test('returns null for non-string input', () => {
      expect(getCachedTip(undefined as unknown as string)).toBeNull();
      expect(getCachedTip(null as unknown as string)).toBeNull();
      expect(getCachedTip(123 as unknown as string)).toBeNull();
    });

    test('result is a fresh object (not shared reference)', () => {
      const a = getCachedTip('squat-knee-cave');
      const b = getCachedTip('squat-knee-cave');
      expect(a).toEqual(b);
      if (a && b) {
        expect(a).not.toBe(b);
      }
    });
  });

  describe('getOfflineFallback', () => {
    test('returns a non-empty tip', () => {
      const tip = getOfflineFallback();
      expect(tip).toHaveProperty('text');
      expect(tip.text.length).toBeGreaterThan(20);
    });

    test('result is a fresh object (caller cannot mutate library)', () => {
      const a = getOfflineFallback();
      const b = getOfflineFallback();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('library coverage', () => {
    test('cache has at least 15 entries', () => {
      const keys = listCachedKeys();
      expect(keys.length).toBeGreaterThanOrEqual(15);
    });

    test('covers both fault ids and exercise slugs', () => {
      const keys = listCachedKeys();
      expect(keys).toContain('squat');
      expect(keys).toContain('squat-knee-cave');
      expect(keys).toContain('pullup');
      expect(keys).toContain('bench');
    });

    test('all values are non-empty and under 300 characters', () => {
      const keys = listCachedKeys();
      for (const key of keys) {
        const tip = getCachedTip(key);
        expect(tip).not.toBeNull();
        expect(tip?.text.length).toBeGreaterThan(0);
        expect(tip?.text.length).toBeLessThanOrEqual(300);
      }
    });

    test('keys are sorted for stable ordering', () => {
      const keys = listCachedKeys();
      expect(keys).toEqual([...keys].sort());
    });
  });
});
