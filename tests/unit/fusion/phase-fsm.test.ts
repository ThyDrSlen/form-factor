import { createPhaseFsm, FSM_PHASE_TIMEOUT_MS } from '@/lib/fusion/phase-fsm';

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

  // =========================================================================
  // Phase Timeout Recovery Tests
  // =========================================================================

  test('stuck phase resets to initial after timeout', () => {
    const fsm = createPhaseFsm('setup');
    const t0 = 10000;

    // Move to a non-idle phase
    fsm.transition('eccentric', t0);
    expect(fsm.current()).toBe('eccentric');

    // Simulate being stuck for > PHASE_TIMEOUT_MS
    const stuckTime = t0 + FSM_PHASE_TIMEOUT_MS + 500;
    const didReset = fsm.tick(stuckTime);

    expect(didReset).toBe(true);
    expect(fsm.current()).toBe('setup');
  });

  test('stuck phase does NOT reset rep count on timeout', () => {
    const fsm = createPhaseFsm('setup');
    const t0 = 10000;

    // Complete one rep
    fsm.transition('eccentric', t0);
    fsm.transition('bottom', t0 + 100);
    fsm.transition('concentric', t0 + 200);
    expect(fsm.repCount()).toBe(1);

    // Move to eccentric and get stuck
    fsm.transition('eccentric', t0 + 300);
    const stuckTime = t0 + 300 + FSM_PHASE_TIMEOUT_MS + 1000;
    fsm.tick(stuckTime);

    // Rep count preserved after timeout
    expect(fsm.repCount()).toBe(1);
    expect(fsm.current()).toBe('setup');
  });

  test('setup phase never times out', () => {
    const fsm = createPhaseFsm('setup');

    // Even after a very long time in setup, no timeout
    const veryLate = Date.now() + FSM_PHASE_TIMEOUT_MS * 10;
    const didReset = fsm.tick(veryLate);

    expect(didReset).toBe(false);
    expect(fsm.current()).toBe('setup');
  });

  test('tick returns false when phase is changing normally', () => {
    const fsm = createPhaseFsm('setup');
    const t0 = 10000;

    fsm.transition('eccentric', t0);

    // Tick shortly after transition (well within timeout)
    const didReset = fsm.tick(t0 + 100);
    expect(didReset).toBe(false);
    expect(fsm.current()).toBe('eccentric');
  });

  test('phase transition resets the timeout timer', () => {
    const fsm = createPhaseFsm('setup');
    const t0 = 10000;

    fsm.transition('eccentric', t0);

    // Wait most of the timeout
    const almostTimeout = t0 + FSM_PHASE_TIMEOUT_MS - 500;
    expect(fsm.tick(almostTimeout)).toBe(false);

    // Transition to next phase resets the timer
    fsm.transition('bottom', almostTimeout);

    // Now even after the original timeout would have expired, no reset
    const afterOriginalTimeout = almostTimeout + 1000;
    expect(fsm.tick(afterOriginalTimeout)).toBe(false);
    expect(fsm.current()).toBe('bottom');
  });
});
