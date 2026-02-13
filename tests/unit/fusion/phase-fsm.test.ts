import { createPhaseFsm } from '@/lib/fusion/phase-fsm';

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
});
