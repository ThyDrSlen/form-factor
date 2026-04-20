import {
  mapSeverityToAudioHint,
  severityToPriority,
  CUE_AUDIO_TABLE,
} from '@/lib/services/cue-priority-audio';

describe('severityToPriority', () => {
  it.each([
    [undefined, 'low'],
    [0, 'low'],
    [1, 'low'],
    [2, 'normal'],
    [3, 'high'],
    [5, 'high'],
  ])('maps severity %p → %p', (sev, expected) => {
    expect(severityToPriority(sev as number | undefined)).toBe(expected);
  });
});

describe('mapSeverityToAudioHint', () => {
  it('returns the low preset for severity 1', () => {
    const hint = mapSeverityToAudioHint(1);
    expect(hint).toEqual(CUE_AUDIO_TABLE.low);
  });

  it('returns normal preset for severity 2', () => {
    expect(mapSeverityToAudioHint(2)).toEqual(CUE_AUDIO_TABLE.normal);
  });

  it('returns high preset for severity 3 with medium haptic + repeat', () => {
    const hint = mapSeverityToAudioHint(3);
    expect(hint.priority).toBe('high');
    expect(hint.haptic).toBe('medium');
    expect(hint.repeatIfUnadopted).toBe(true);
    expect(hint.volume).toBeGreaterThanOrEqual(0.9);
  });

  it('elevates low → normal when fatigued', () => {
    const hint = mapSeverityToAudioHint(1, { isFatigued: true });
    expect(hint.priority).toBe('normal');
  });

  it('elevates normal → high when fatigued', () => {
    const hint = mapSeverityToAudioHint(2, { isFatigued: true });
    expect(hint.priority).toBe('high');
  });

  it('adds interval padding when an active cue is already repeating', () => {
    const baseline = mapSeverityToAudioHint(2);
    const padded = mapSeverityToAudioHint(2, { isActiveCue: true });
    expect(padded.intervalMs).toBe(baseline.intervalMs + 400);
  });
});
