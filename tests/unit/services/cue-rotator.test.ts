import { createCueRotator } from '@/lib/services/cue-rotator';
import { CUE_ROTATION_VARIANTS } from '@/lib/services/cue-rotator-variants';

describe('cue-rotator', () => {
  describe('core behavior', () => {
    it('returns the base string unchanged when it has no variants', () => {
      const rotator = createCueRotator({});
      expect(rotator.rotate('Anything goes')).toBe('Anything goes');
    });

    it('returns the base string unchanged for keys with empty variant arrays', () => {
      const rotator = createCueRotator({ 'Keep it up.': [] });
      expect(rotator.rotate('Keep it up.')).toBe('Keep it up.');
    });

    it('cycles through variants in order', () => {
      const rotator = createCueRotator({ X: ['a', 'b', 'c'] });
      expect(rotator.rotate('X')).toBe('a');
      expect(rotator.rotate('X')).toBe('b');
      expect(rotator.rotate('X')).toBe('c');
      expect(rotator.rotate('X')).toBe('a');
    });

    it('tracks per-key state independently', () => {
      const rotator = createCueRotator({
        X: ['x1', 'x2'],
        Y: ['y1', 'y2', 'y3'],
      });
      expect(rotator.rotate('X')).toBe('x1');
      expect(rotator.rotate('Y')).toBe('y1');
      expect(rotator.rotate('X')).toBe('x2');
      expect(rotator.rotate('Y')).toBe('y2');
      expect(rotator.rotate('X')).toBe('x1'); // X wrapped
      expect(rotator.rotate('Y')).toBe('y3');
    });

    it('falls through for unknown keys without side-effects on known keys', () => {
      const rotator = createCueRotator({ Known: ['a', 'b'] });
      expect(rotator.rotate('Known')).toBe('a');
      expect(rotator.rotate('Unknown')).toBe('Unknown');
      expect(rotator.rotate('Unknown')).toBe('Unknown');
      expect(rotator.rotate('Known')).toBe('b');
    });

    it('reset() clears rotation state across all keys', () => {
      const rotator = createCueRotator({ X: ['a', 'b', 'c'] });
      rotator.rotate('X');
      rotator.rotate('X');
      rotator.reset();
      expect(rotator.rotate('X')).toBe('a');
    });

    it('handles single-variant keys as a no-op rotation', () => {
      const rotator = createCueRotator({ Solo: ['only'] });
      expect(rotator.rotate('Solo')).toBe('only');
      expect(rotator.rotate('Solo')).toBe('only');
      expect(rotator.rotate('Solo')).toBe('only');
    });
  });

  describe('authored variants integration', () => {
    it('all authored base strings exist in the map with at least 2 variants', () => {
      for (const [base, variants] of Object.entries(CUE_ROTATION_VARIANTS)) {
        expect(variants.length).toBeGreaterThanOrEqual(2);
        expect(base.length).toBeGreaterThan(0);
      }
    });

    it('no variant is byte-equal to its base (would waste a rotation slot)', () => {
      for (const [base, variants] of Object.entries(CUE_ROTATION_VARIANTS)) {
        for (const variant of variants) {
          expect(variant).not.toBe(base);
        }
      }
    });

    it('variants are reasonably short (<= 80 chars) to fit TTS + UI constraints', () => {
      for (const variants of Object.values(CUE_ROTATION_VARIANTS)) {
        for (const variant of variants) {
          expect(variant.length).toBeLessThanOrEqual(80);
        }
      }
    });

    it('rotates a real authored cue end-to-end', () => {
      const rotator = createCueRotator(CUE_ROTATION_VARIANTS);
      const hipSag = 'Squeeze glutes to stop hip sag.';
      const first = rotator.rotate(hipSag);
      const second = rotator.rotate(hipSag);
      expect(first).not.toBe(second);
      expect(first).not.toBe(hipSag);
    });
  });
});
