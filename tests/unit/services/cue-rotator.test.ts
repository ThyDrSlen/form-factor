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

    it('covers the live workout cue surface (floor check)', () => {
      // Every base string in lib/workouts/*.ts should have a variant set
      // here. Exact match matters — the rotator is a strict lookup. Bump
      // this floor whenever coverage expands so accidental deletions fail.
      expect(Object.keys(CUE_ROTATION_VARIANTS).length).toBeGreaterThanOrEqual(25);
    });

    it('covers a representative cue from each supported workout', () => {
      const mustCover = [
        'Squeeze glutes to stop hip sag.', // pushup
        'Stand all the way up between reps.', // squat
        'Finish each rep with full hip extension.', // deadlift
        'Hinge deeper — feel the hamstring stretch.', // rdl
        'Fully extend your arms before the next rep.', // pullup
        'Straighten your arms for a true dead hang.', // dead-hang
        'Keep shoulders level — balance the load.', // farmers-walk
      ];
      for (const cue of mustCover) {
        expect(CUE_ROTATION_VARIANTS[cue]?.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('authored variants content safety', () => {
    // Spoken via TTS. Catches authoring mistakes before they reach users.
    // All iteration below walks every variant across every entry.
    const allVariants: Array<{ base: string; variant: string }> = [];
    for (const [base, variants] of Object.entries(CUE_ROTATION_VARIANTS)) {
      for (const variant of variants) {
        allVariants.push({ base, variant });
      }
    }

    it('has no exclamation points (TTS reads them flat — adds no energy)', () => {
      for (const { base, variant } of allVariants) {
        if (variant.includes('!')) {
          throw new Error(`"${variant}" (variant of "${base}") contains an exclamation`);
        }
      }
    });

    it('has no shouted ALL-CAPS words of 3+ characters', () => {
      // Allow acronyms/abbreviations up to 2 chars. Multi-cap runs usually
      // signal a typo or a test-yelling accident.
      const yellRegex = /\b[A-Z]{3,}\b/;
      for (const { base, variant } of allVariants) {
        if (yellRegex.test(variant)) {
          throw new Error(`"${variant}" (variant of "${base}") contains an ALL-CAPS run`);
        }
      }
    });

    it('has no medical-diagnosis or treatment verbs', () => {
      // Form Factor is a coaching app, not a clinic. Keep language
      // movement-focused.
      const medical = /\b(diagnose|diagnosis|treat|cure|prescribe|therapy|medicate)\b/i;
      for (const { base, variant } of allVariants) {
        if (medical.test(variant)) {
          throw new Error(
            `"${variant}" (variant of "${base}") uses medical-diagnosis language`,
          );
        }
      }
    });

    it('has no leading or trailing whitespace', () => {
      for (const { base, variant } of allVariants) {
        expect(variant).toBe(variant.trim());
        if (variant.length === 0) {
          throw new Error(`empty variant for "${base}"`);
        }
      }
    });

    it('has no collapsed punctuation runs (e.g. "..", "??", "—— ")', () => {
      const runs = /[.!?]{2,}|——/;
      for (const { base, variant } of allVariants) {
        if (runs.test(variant)) {
          throw new Error(
            `"${variant}" (variant of "${base}") has a collapsed punctuation run`,
          );
        }
      }
    });
  });
});
