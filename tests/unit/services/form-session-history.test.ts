import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE,
  FORM_SESSION_HISTORY_STORAGE_KEY,
  appendFormSessionHistory,
  clearFormSessionHistory,
  getFormSessionHistory,
} from '@/lib/services/form-session-history';

describe('form-session-history', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns an empty list when nothing has been logged', async () => {
    await expect(getFormSessionHistory('pullup')).resolves.toEqual([]);
  });

  it('appends a new entry and returns it on next read', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 82,
      endedAt: '2026-04-20T10:00:00Z',
      sessionId: 'sess_1',
    });
    const stored = await getFormSessionHistory('pullup');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      exerciseKey: 'pullup',
      avgFqi: 82,
      sessionId: 'sess_1',
    });
  });

  it('keeps exercises isolated from each other', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 82,
      endedAt: '2026-04-20T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'squat',
      avgFqi: 70,
      endedAt: '2026-04-20T11:00:00Z',
    });

    const pullup = await getFormSessionHistory('pullup');
    const squat = await getFormSessionHistory('squat');
    expect(pullup).toHaveLength(1);
    expect(squat).toHaveLength(1);
    expect(pullup[0].avgFqi).toBe(82);
    expect(squat[0].avgFqi).toBe(70);
  });

  it('stores newest first', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 80,
      endedAt: '2026-04-20T10:00:00Z',
    });
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 85,
      endedAt: '2026-04-20T11:00:00Z',
    });
    const stored = await getFormSessionHistory('pullup');
    expect(stored[0].avgFqi).toBe(85);
    expect(stored[1].avgFqi).toBe(80);
  });

  it('caps the per-exercise history to MAX_ENTRIES', async () => {
    for (let i = 0; i < FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE + 4; i += 1) {
      await appendFormSessionHistory({
        exerciseKey: 'pullup',
        avgFqi: 70 + (i % 10),
        endedAt: `2026-04-20T10:0${i % 10}:00Z`,
      });
    }
    const stored = await getFormSessionHistory('pullup');
    expect(stored).toHaveLength(FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE);
  });

  it('ignores writes without an exerciseKey', async () => {
    await appendFormSessionHistory({
      exerciseKey: '',
      avgFqi: 80,
      endedAt: '2026-04-20T10:00:00Z',
    });
    const raw = await AsyncStorage.getItem(FORM_SESSION_HISTORY_STORAGE_KEY);
    expect(raw).toBeNull();
  });

  it('ignores writes with a non-finite avgFqi', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: Number.NaN,
      endedAt: '2026-04-20T10:00:00Z',
    });
    await expect(getFormSessionHistory('pullup')).resolves.toEqual([]);
  });

  it('survives corrupt storage by returning empty', async () => {
    await AsyncStorage.setItem(FORM_SESSION_HISTORY_STORAGE_KEY, '{garbage');
    await expect(getFormSessionHistory('pullup')).resolves.toEqual([]);
  });

  it('clearFormSessionHistory nukes everything', async () => {
    await appendFormSessionHistory({
      exerciseKey: 'pullup',
      avgFqi: 82,
      endedAt: '2026-04-20T10:00:00Z',
    });
    await clearFormSessionHistory();
    await expect(getFormSessionHistory('pullup')).resolves.toEqual([]);
  });
});
