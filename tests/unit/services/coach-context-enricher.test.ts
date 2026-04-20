jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    getAllWorkouts: jest.fn(),
  },
}));

// Grab a typed handle to the mocked function AFTER jest.mock has hoisted.
import { localDB as mockedLocalDB } from '@/lib/services/database/local-db';
const mockGetAllWorkouts = mockedLocalDB.getAllWorkouts as jest.Mock;

import type { LocalWorkout } from '@/lib/services/database/local-db';
import {
  MAX_CONTEXT_CHARS,
  MAX_RECENT_WORKOUTS,
  enrichCoachContext,
  fetchRecentWorkouts,
  formatWorkoutLine,
  summarizeWorkouts,
} from '@/lib/services/coach-context-enricher';

function makeWorkout(overrides: Partial<LocalWorkout> = {}): LocalWorkout {
  return {
    id: overrides.id ?? `w-${Math.random().toString(36).slice(2, 6)}`,
    exercise: overrides.exercise ?? 'Back Squat',
    sets: overrides.sets ?? 3,
    reps: overrides.reps ?? 5,
    weight: overrides.weight ?? 225,
    duration: overrides.duration,
    date: overrides.date ?? '2026-04-10',
    synced: overrides.synced ?? 1,
    deleted: overrides.deleted ?? 0,
    updated_at: overrides.updated_at ?? '2026-04-10T10:00:00Z',
  };
}

describe('coach-context-enricher / formatWorkoutLine', () => {
  it('renders date — exercise (sets × reps @ weight)', () => {
    const line = formatWorkoutLine(makeWorkout({ date: '2026-04-01', exercise: 'Bench Press', sets: 5, reps: 5, weight: 185 }));
    expect(line).toBe('2026-04-01 — Bench Press — 5s 5r 185lb');
  });

  it('omits missing numeric fields gracefully', () => {
    const line = formatWorkoutLine(makeWorkout({ date: '2026-04-02', exercise: 'Plank', sets: 0, reps: undefined, weight: undefined, duration: 60 }));
    expect(line).toContain('Plank');
    expect(line).toContain('60s dur');
    expect(line).not.toContain('undefined');
  });
});

describe('coach-context-enricher / summarizeWorkouts', () => {
  it('returns empty string on empty input', () => {
    expect(summarizeWorkouts([])).toBe('');
  });

  it('sorts newest-first regardless of input order', () => {
    const summary = summarizeWorkouts([
      makeWorkout({ date: '2026-04-01', exercise: 'Old' }),
      makeWorkout({ date: '2026-04-10', exercise: 'New' }),
      makeWorkout({ date: '2026-04-05', exercise: 'Mid' }),
    ]);
    const newIdx = summary.indexOf('New');
    const midIdx = summary.indexOf('Mid');
    const oldIdx = summary.indexOf('Old');
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  it('caps total chars at the configured budget', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      makeWorkout({
        id: `w${i}`,
        exercise: `Exercise With A Very Long Name ${i}`,
        date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
      })
    );
    const summary = summarizeWorkouts(many, 400);
    expect(summary.length).toBeLessThanOrEqual(420); // soft bound
  });

  it('prepends PR/PR-like ordering header', () => {
    const summary = summarizeWorkouts([makeWorkout({ date: '2026-04-10' })]);
    expect(summary.startsWith('Last ')).toBe(true);
    expect(summary.endsWith('.')).toBe(true);
  });
});

describe('coach-context-enricher / fetchRecentWorkouts', () => {
  beforeEach(() => {
    mockGetAllWorkouts.mockReset();
  });

  it('uses the injected fetcher when provided', async () => {
    const fetcher = jest.fn().mockResolvedValue([makeWorkout({ date: '2026-04-10' })]);
    const out = await fetchRecentWorkouts(5, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockGetAllWorkouts).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });

  it('falls back to localDB.getAllWorkouts otherwise', async () => {
    mockGetAllWorkouts.mockResolvedValue([makeWorkout()]);
    await fetchRecentWorkouts(5);
    expect(mockGetAllWorkouts).toHaveBeenCalledTimes(1);
  });

  it('limits results to the requested count, newest-first', async () => {
    const rows = [
      makeWorkout({ id: 'a', date: '2026-04-05' }),
      makeWorkout({ id: 'b', date: '2026-04-10' }),
      makeWorkout({ id: 'c', date: '2026-04-01' }),
      makeWorkout({ id: 'd', date: '2026-04-08' }),
    ];
    mockGetAllWorkouts.mockResolvedValue(rows);
    const out = await fetchRecentWorkouts(2);
    expect(out).toHaveLength(2);
    expect(out[0].date).toBe('2026-04-10');
    expect(out[1].date).toBe('2026-04-08');
  });

  it('returns [] and warns on DB failure', async () => {
    mockGetAllWorkouts.mockRejectedValue(new Error('db closed'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchRecentWorkouts();
    expect(out).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe('coach-context-enricher / enrichCoachContext', () => {
  beforeEach(() => {
    mockGetAllWorkouts.mockReset();
  });

  it('returns empty string when no workouts available', async () => {
    mockGetAllWorkouts.mockResolvedValue([]);
    const out = await enrichCoachContext();
    expect(out).toBe('');
  });

  it('produces a non-empty summary when workouts exist', async () => {
    mockGetAllWorkouts.mockResolvedValue([
      makeWorkout({ date: '2026-04-10', exercise: 'Squat' }),
    ]);
    const out = await enrichCoachContext();
    expect(out).toContain('Squat');
    expect(out.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 50);
  });

  it('honours injected fetcher so callers can avoid DB', async () => {
    const out = await enrichCoachContext({
      fetchWorkouts: async () => [makeWorkout({ date: '2026-04-10', exercise: 'Deadlift' })],
    });
    expect(out).toContain('Deadlift');
    expect(mockGetAllWorkouts).not.toHaveBeenCalled();
  });

  it('respects custom maxWorkouts', async () => {
    const rows = Array.from({ length: MAX_RECENT_WORKOUTS + 5 }, (_, i) =>
      makeWorkout({ id: `w${i}`, date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const out = await enrichCoachContext({
      maxWorkouts: 3,
      fetchWorkouts: async () => rows,
    });
    // summary must include at most 3 items — count the "—" separators.
    const occurrences = out.split(' — ').length - 1;
    // each item contributes >=1 "—" plus item-internal ones; check item count via ";"
    const items = out.split(';').length;
    expect(items).toBeLessThanOrEqual(3);
    expect(occurrences).toBeGreaterThan(0);
  });
});
