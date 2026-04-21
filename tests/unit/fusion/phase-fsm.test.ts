import { createPhaseFsm } from '@/lib/fusion/phase-fsm';
import type { Phase } from '@/lib/fusion/contracts';

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
  // Wave 30 C5 — rep-cycle + idempotency + whole-graph validation.
  //
  // The FSM is the backbone of rep counting; a missed transition or a
  // double-count on a no-op transition translates directly into wrong
  // set totals in the workout log. These tests cover the multi-rep
  // happy path plus the defensive edges around self-transitions,
  // skipped phases, and the full ALLOWED_TRANSITIONS graph.
  // ---------------------------------------------------------------------------

  describe('full rep cycle (wave-30 C5)', () => {
    test('setup → top → eccentric → bottom → concentric → top increments repCount once', () => {
      const fsm = createPhaseFsm('setup');

      expect(fsm.transition('top')).toBe(true);
      expect(fsm.transition('eccentric')).toBe(true);
      expect(fsm.transition('bottom')).toBe(true);
      // Rep only counts at bottom→concentric.
      expect(fsm.repCount()).toBe(0);
      expect(fsm.transition('concentric')).toBe(true);
      expect(fsm.repCount()).toBe(1);
      expect(fsm.transition('top')).toBe(true);
      // Returning to top does not re-count — counter is still 1.
      expect(fsm.repCount()).toBe(1);
      expect(fsm.current()).toBe('top');
    });

    test('three consecutive full cycles yield repCount === 3', () => {
      const fsm = createPhaseFsm('top');
      for (let i = 0; i < 3; i += 1) {
        expect(fsm.transition('eccentric')).toBe(true);
        expect(fsm.transition('bottom')).toBe(true);
        expect(fsm.transition('concentric')).toBe(true);
        expect(fsm.transition('top')).toBe(true);
      }
      expect(fsm.repCount()).toBe(3);
      expect(fsm.current()).toBe('top');
    });
  });

  describe('idempotency + invalid edges (wave-30 C5)', () => {
    test('transition(top) from top is accepted but does not advance state or count', () => {
      const fsm = createPhaseFsm('top');

      // Self-transitions are treated as a no-op accept — see source
      // early-return: `if (next === this.phase) return true;`.
      expect(fsm.transition('top')).toBe(true);
      expect(fsm.transition('top')).toBe(true);
      expect(fsm.current()).toBe('top');
      expect(fsm.repCount()).toBe(0);
    });

    test('transition(concentric) from setup is rejected (cannot skip phases)', () => {
      const fsm = createPhaseFsm('setup');

      // setup → concentric is NOT in ALLOWED_TRANSITIONS[setup]
      // (allowed: top, eccentric). The FSM must stay on `setup` and
      // return false.
      expect(fsm.transition('concentric')).toBe(false);
      expect(fsm.current()).toBe('setup');
      expect(fsm.repCount()).toBe(0);
    });

    test('transition(bottom) from concentric is rejected (invalid forward skip)', () => {
      // Drive into concentric via a legal path first.
      const fsm = createPhaseFsm('top');
      fsm.transition('eccentric');
      fsm.transition('bottom');
      fsm.transition('concentric');
      expect(fsm.current()).toBe('concentric');

      // concentric → bottom is NOT allowed (allowed: top, eccentric).
      expect(fsm.transition('bottom')).toBe(false);
      expect(fsm.current()).toBe('concentric');
      expect(fsm.repCount()).toBe(1);
    });
  });

  describe('ALLOWED_TRANSITIONS graph (wave-30 C5)', () => {
    // Mirror of the source's ALLOWED_TRANSITIONS table. This is
    // intentionally duplicated so that if the source graph changes
    // silently, the test surface forces an explicit review.
    const allowedGraph: Record<Phase, Phase[]> = {
      setup: ['top', 'eccentric'],
      top: ['eccentric'],
      eccentric: ['bottom'],
      bottom: ['concentric'],
      concentric: ['top', 'eccentric'],
    };

    const allPhases: Phase[] = ['setup', 'top', 'eccentric', 'bottom', 'concentric'];

    // Parametrised coverage: for every source phase, every listed edge
    // is accepted, and every non-listed edge (other than self) is
    // rejected.
    for (const from of allPhases) {
      for (const to of allPhases) {
        const expectAccepted = from === to || allowedGraph[from].includes(to);
        test(`transition from ${from} → ${to} is ${expectAccepted ? 'accepted' : 'rejected'}`, () => {
          const fsm = createPhaseFsm(from);
          const accepted = fsm.transition(to);
          expect(accepted).toBe(expectAccepted);
          if (!expectAccepted) {
            // Invalid transitions must NOT mutate current().
            expect(fsm.current()).toBe(from);
          }
        });
      }
    }
  });
});
