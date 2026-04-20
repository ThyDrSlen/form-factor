import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DECAY_WINDOW_MS,
  MAX_RECORDS,
  STALE_CUTOFF_MS,
  __resetForTests,
  clearAll,
  getCuePreference,
  getExercisePreferences,
  loadFeedback,
  pruneStale,
  recordFeedback,
} from '@/lib/services/coach-cue-feedback';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('coach-cue-feedback', () => {
  beforeEach(async () => {
    await __resetForTests();
  });

  describe('recordFeedback', () => {
    it('requires exerciseId, cueKey, and a valid vote', async () => {
      await expect(
        recordFeedback({ exerciseId: '', cueKey: 'k', vote: 'up' }),
      ).rejects.toThrow(/exerciseId/i);
      await expect(
        recordFeedback({ exerciseId: 'squat', cueKey: '', vote: 'up' }),
      ).rejects.toThrow(/cueKey/i);
      await expect(
        recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'meh' as never }),
      ).rejects.toThrow(/vote/i);
    });

    it('normalizes case and trims whitespace on keys', async () => {
      await recordFeedback({ exerciseId: '  Squat ', cueKey: ' KneesOut ', vote: 'up' });
      const feedback = await loadFeedback();
      expect(feedback[0].exerciseId).toBe('squat');
      expect(feedback[0].cueKey).toBe('kneesout');
    });

    it('truncates long notes to 280 chars', async () => {
      await recordFeedback({
        exerciseId: 'squat',
        cueKey: 'k',
        vote: 'down',
        note: 'x'.repeat(500),
      });
      const feedback = await loadFeedback();
      expect(feedback[0].note?.length).toBe(280);
    });

    it('bounds the index to MAX_RECORDS with FIFO trim', async () => {
      for (let i = 0; i < MAX_RECORDS + 10; i++) {
        await recordFeedback({ exerciseId: 'squat', cueKey: `c${i}`, vote: 'up' });
      }
      const feedback = await loadFeedback();
      expect(feedback.length).toBe(MAX_RECORDS);
      expect(feedback[0].cueKey).toBe(`c10`);
      expect(feedback[feedback.length - 1].cueKey).toBe(`c${MAX_RECORDS + 9}`);
    });
  });

  describe('getCuePreference', () => {
    it('returns neutral score for cues with no feedback', async () => {
      const pref = await getCuePreference('squat', 'kneesout');
      expect(pref.score).toBe(0);
      expect(pref.voteCount).toBe(0);
    });

    it('scores a fresh up-vote close to +1', async () => {
      const now = Date.now();
      await recordFeedback({ exerciseId: 'squat', cueKey: 'kneesout', vote: 'up', now });
      const pref = await getCuePreference('squat', 'kneesout', now);
      expect(pref.score).toBe(1);
      expect(pref.voteCount).toBe(1);
    });

    it('scores a fresh down-vote close to -1', async () => {
      const now = Date.now();
      await recordFeedback({ exerciseId: 'squat', cueKey: 'kneesout', vote: 'down', now });
      const pref = await getCuePreference('squat', 'kneesout', now);
      expect(pref.score).toBe(-1);
    });

    it('averages mixed votes toward zero', async () => {
      const now = Date.now();
      await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'up', now });
      await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'down', now });
      const pref = await getCuePreference('squat', 'k', now);
      expect(pref.score).toBe(0);
      expect(pref.voteCount).toBe(2);
    });

    it('decays older votes linearly toward zero weight', async () => {
      const now = Date.now();
      // 5 up votes 29 days old (low weight) and 1 down vote today (full weight)
      for (let i = 0; i < 5; i++) {
        await recordFeedback({
          exerciseId: 'squat',
          cueKey: 'k',
          vote: 'up',
          now: now - 29 * MS_PER_DAY,
        });
      }
      await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'down', now });
      const pref = await getCuePreference('squat', 'k', now);
      // Heavy fresh down vote should dominate over many stale up votes.
      expect(pref.score).toBeLessThan(0);
    });

    it('ignores votes older than the decay window', async () => {
      const now = Date.now();
      await recordFeedback({
        exerciseId: 'squat',
        cueKey: 'k',
        vote: 'up',
        now: now - DECAY_WINDOW_MS - 1,
      });
      const pref = await getCuePreference('squat', 'k', now);
      expect(pref.voteCount).toBe(0);
      expect(pref.score).toBe(0);
    });

    it('isolates feedback per (exerciseId, cueKey) pair', async () => {
      await recordFeedback({ exerciseId: 'squat', cueKey: 'a', vote: 'up' });
      await recordFeedback({ exerciseId: 'squat', cueKey: 'b', vote: 'down' });
      await recordFeedback({ exerciseId: 'deadlift', cueKey: 'a', vote: 'down' });

      const squatA = await getCuePreference('squat', 'a');
      const squatB = await getCuePreference('squat', 'b');
      const deadliftA = await getCuePreference('deadlift', 'a');

      expect(squatA.score).toBe(1);
      expect(squatB.score).toBe(-1);
      expect(deadliftA.score).toBe(-1);
    });
  });

  describe('getExercisePreferences', () => {
    it('returns an empty list when there is no feedback', async () => {
      const prefs = await getExercisePreferences('squat');
      expect(prefs).toEqual([]);
    });

    it('groups by cueKey and surfaces score + voteCount', async () => {
      await recordFeedback({ exerciseId: 'squat', cueKey: 'kneesout', vote: 'up' });
      await recordFeedback({ exerciseId: 'squat', cueKey: 'kneesout', vote: 'up' });
      await recordFeedback({ exerciseId: 'squat', cueKey: 'heels', vote: 'down' });

      const prefs = await getExercisePreferences('squat');
      const keys = prefs.map((p) => p.cueKey).sort();
      expect(keys).toEqual(['heels', 'kneesout']);
      const kneesout = prefs.find((p) => p.cueKey === 'kneesout');
      expect(kneesout?.voteCount).toBe(2);
      expect(kneesout?.score).toBe(1);
    });
  });

  describe('pruneStale', () => {
    it('removes records older than STALE_CUTOFF_MS', async () => {
      const now = Date.now();
      await recordFeedback({
        exerciseId: 'squat',
        cueKey: 'old',
        vote: 'up',
        now: now - STALE_CUTOFF_MS - 1,
      });
      await recordFeedback({
        exerciseId: 'squat',
        cueKey: 'new',
        vote: 'up',
        now,
      });

      const removed = await pruneStale(now);
      expect(removed).toBe(1);
      const remaining = await loadFeedback();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].cueKey).toBe('new');
    });

    it('returns 0 when nothing is stale', async () => {
      await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'up' });
      const removed = await pruneStale();
      expect(removed).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('wipes all records', async () => {
      await recordFeedback({ exerciseId: 'squat', cueKey: 'k', vote: 'up' });
      await clearAll();
      const feedback = await loadFeedback();
      expect(feedback).toEqual([]);
    });
  });

  describe('resilience', () => {
    it('returns a neutral preference when storage is corrupt', async () => {
      await AsyncStorage.setItem('coach_cue_feedback_v1', '{not json');
      const pref = await getCuePreference('squat', 'k');
      expect(pref.score).toBe(0);
      expect(pref.voteCount).toBe(0);
    });

    it('drops records with a malformed shape', async () => {
      await AsyncStorage.setItem(
        'coach_cue_feedback_v1',
        JSON.stringify({
          version: 1,
          records: [
            { exerciseId: 'squat', cueKey: 'ok', vote: 'up', createdAt: Date.now() },
            { exerciseId: 'squat', cueKey: 'bad', vote: 'sideways', createdAt: Date.now() },
            { exerciseId: null, cueKey: 'bad2', vote: 'up', createdAt: Date.now() },
          ],
        }),
      );
      const feedback = await loadFeedback();
      expect(feedback).toHaveLength(1);
      expect(feedback[0].cueKey).toBe('ok');
    });
  });
});
