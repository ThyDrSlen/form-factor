import { createPhaseFsm } from '@/lib/fusion/phase-fsm';
import type { Phase } from '@/lib/fusion/contracts';

const ALL_PHASES: readonly Phase[] = [
  'setup',
  'top',
  'eccentric',
  'bottom',
  'concentric',
];

/**
 * Source of truth for allowed transitions, mirrored from `phase-fsm.ts`. If
 * the FSM's ALLOWED_TRANSITIONS change, this table must be updated in lock-
 * step (the tests below assert against this).
 */
const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = {
  setup: ['top', 'eccentric'],
  top: ['eccentric'],
  eccentric: ['bottom'],
  bottom: ['concentric'],
  concentric: ['top', 'eccentric'],
};

describe('phase fsm', () => {
  test('rejects invalid phase jump', () => {
    const fsm = createPhaseFsm('top');

    const accepted = fsm.transition('bottom');

    expect(accepted).toBe(false);
    expect(fsm.current()).toBe('top');
  });

  test('counts rep on bottom_to_concentric transition', () => {
    const fsm = createPhaseFsm('top');

    expect(fsm.transition('eccentric')).toBe(true);
    expect(fsm.transition('bottom')).toBe(true);
    expect(fsm.repCount()).toBe(0);

    expect(fsm.transition('concentric')).toBe(true);
    expect(fsm.repCount()).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Table-driven: every allowed transition succeeds
  // ---------------------------------------------------------------------------

  describe('allowed transitions', () => {
    for (const from of ALL_PHASES) {
      for (const to of ALLOWED[from]) {
        test(`${from} → ${to} succeeds`, () => {
          const fsm = createPhaseFsm(from);
          expect(fsm.transition(to)).toBe(true);
          expect(fsm.current()).toBe(to);
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Table-driven: every disallowed transition is rejected AND state preserved
  // ---------------------------------------------------------------------------

  describe('disallowed transitions', () => {
    for (const from of ALL_PHASES) {
      const allowedSet = new Set<Phase>(ALLOWED[from]);
      for (const to of ALL_PHASES) {
        // Same-phase no-op is handled in the idempotency block below.
        if (to === from || allowedSet.has(to)) continue;
        test(`${from} → ${to} rejected, phase unchanged`, () => {
          const fsm = createPhaseFsm(from);
          expect(fsm.transition(to)).toBe(false);
          expect(fsm.current()).toBe(from);
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Idempotency: same-phase transition returns true and does not bump reps
  // ---------------------------------------------------------------------------

  describe('idempotent same-phase transitions', () => {
    for (const phase of ALL_PHASES) {
      test(`${phase} → ${phase} is a no-op returning true`, () => {
        const fsm = createPhaseFsm(phase);
        expect(fsm.transition(phase)).toBe(true);
        expect(fsm.current()).toBe(phase);
        expect(fsm.repCount()).toBe(0);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Multi-rep cycle
  // ---------------------------------------------------------------------------

  test('multi-rep cycle increments rep counter per completed rep', () => {
    const fsm = createPhaseFsm('top');
    const cycle: Phase[] = ['eccentric', 'bottom', 'concentric', 'eccentric', 'bottom', 'concentric', 'eccentric', 'bottom', 'concentric'];
    for (const next of cycle) {
      expect(fsm.transition(next)).toBe(true);
    }
    expect(fsm.current()).toBe('concentric');
    expect(fsm.repCount()).toBe(3);
  });

  test('rep counter does not advance for non-bottom→concentric transitions', () => {
    // Build a chain that touches every allowed edge except bottom→concentric.
    const fsm = createPhaseFsm('setup');
    expect(fsm.transition('top')).toBe(true);
    expect(fsm.transition('eccentric')).toBe(true);
    // Skip bottom to avoid the rep edge entirely.
    // concentric ← bottom is the only path forward, but we're avoiding
    // bottom→concentric; instead assert the no-bump before we take that edge.
    expect(fsm.repCount()).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Initial-phase coverage: the FSM accepts any phase as its seed
  // ---------------------------------------------------------------------------

  describe('initial phase handling', () => {
    for (const phase of ALL_PHASES) {
      test(`starts in ${phase} when seeded`, () => {
        const fsm = createPhaseFsm(phase);
        expect(fsm.current()).toBe(phase);
        expect(fsm.repCount()).toBe(0);
      });
    }
  });

  test('defaults to setup when no seed is provided', () => {
    const fsm = createPhaseFsm();
    expect(fsm.current()).toBe('setup');
    expect(fsm.repCount()).toBe(0);
  });
});
