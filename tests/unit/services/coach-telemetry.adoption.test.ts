import {
  getAdoptionRate,
  getCounter,
  recordCoachCueAdopted,
  recordCoachCueEmitted,
  resetTelemetry,
} from '@/lib/services/coach-telemetry';

describe('coach-telemetry cue adoption', () => {
  beforeEach(() => {
    resetTelemetry();
  });

  it('returns 1.0 when nothing has been emitted (neutral default)', () => {
    expect(getAdoptionRate()).toBe(1);
  });

  it('returns 0.5 when half of emitted cues were adopted', () => {
    recordCoachCueEmitted('cue_knee_valgus', 'session-1');
    recordCoachCueEmitted('cue_depth_short', 'session-1');
    recordCoachCueAdopted('cue_knee_valgus', 'session-1');
    expect(getAdoptionRate()).toBeCloseTo(0.5, 5);
  });

  it('returns 1.0 when every emitted cue was adopted', () => {
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueEmitted('cue_b', 'session-1');
    recordCoachCueAdopted('cue_a', 'session-1');
    recordCoachCueAdopted('cue_b', 'session-1');
    expect(getAdoptionRate()).toBe(1);
  });

  it('treats repeated emissions of the same (cue, session) as a single denominator unit', () => {
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueAdopted('cue_a', 'session-1');
    expect(getAdoptionRate()).toBe(1);
  });

  it('returns 0.0 on reset followed by emissions only (no adoptions)', () => {
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueAdopted('cue_a', 'session-1');
    expect(getAdoptionRate()).toBe(1);

    resetTelemetry();
    recordCoachCueEmitted('cue_b', 'session-2');
    recordCoachCueEmitted('cue_c', 'session-2');
    expect(getAdoptionRate()).toBe(0);
  });

  it('ignores empty ids/sessions', () => {
    recordCoachCueEmitted('', 'session-1');
    recordCoachCueEmitted('cue', '');
    recordCoachCueAdopted('', '');
    expect(getAdoptionRate()).toBe(1); // no emissions recorded
  });

  it('increments raw counters in addition to unique-pair tracking', () => {
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueEmitted('cue_a', 'session-1'); // same pair, but still a counter tick
    recordCoachCueAdopted('cue_a', 'session-1');
    expect(getCounter('coach_cue_emitted')).toBe(2);
    expect(getCounter('coach_cue_adopted')).toBe(1);
  });

  it('counts adoptions across different sessions independently', () => {
    recordCoachCueEmitted('cue_a', 'session-1');
    recordCoachCueEmitted('cue_a', 'session-2');
    recordCoachCueAdopted('cue_a', 'session-2');
    expect(getAdoptionRate()).toBeCloseTo(0.5, 5);
  });
});
