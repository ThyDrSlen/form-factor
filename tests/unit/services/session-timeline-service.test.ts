jest.mock('@/lib/services/database/local-db', () => ({
  localDB: {
    db: {
      getAllAsync: jest.fn(),
    },
  },
}));

import { localDB } from '@/lib/services/database/local-db';
import {
  classifyBucket,
  getUnifiedTimeline,
  groupByDateBucket,
  type TimelineEntry,
} from '@/lib/services/session-timeline-service';

const dbGetAll = localDB.db!.getAllAsync as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// classifyBucket
// ---------------------------------------------------------------------------

describe('classifyBucket', () => {
  const now = new Date('2026-04-16T12:00:00.000Z');

  it('buckets same-day as "today"', () => {
    expect(
      classifyBucket('2026-04-16T08:00:00.000Z', now),
    ).toBe('today');
  });

  it('buckets 1 day ago as "yesterday"', () => {
    expect(
      classifyBucket('2026-04-15T12:00:00.000Z', now),
    ).toBe('yesterday');
  });

  it('buckets 3 days ago as "this_week"', () => {
    expect(
      classifyBucket('2026-04-13T12:00:00.000Z', now),
    ).toBe('this_week');
  });

  it('buckets 10 days ago as "last_week"', () => {
    expect(
      classifyBucket('2026-04-06T12:00:00.000Z', now),
    ).toBe('last_week');
  });

  it('buckets 20 days ago as "this_month"', () => {
    expect(
      classifyBucket('2026-03-27T12:00:00.000Z', now),
    ).toBe('this_month');
  });

  it('buckets > 30 days ago as "older"', () => {
    expect(
      classifyBucket('2026-01-01T12:00:00.000Z', now),
    ).toBe('older');
  });

  it('handles invalid timestamps by bucketing as "older"', () => {
    expect(classifyBucket('not-a-date', now)).toBe('older');
  });
});

// ---------------------------------------------------------------------------
// getUnifiedTimeline
// ---------------------------------------------------------------------------

describe('getUnifiedTimeline', () => {
  it('returns workout entries sorted newest-first', async () => {
    dbGetAll.mockResolvedValueOnce([
      {
        id: 'w1',
        name: 'Leg Day',
        started_at: '2026-04-14T08:00:00.000Z',
        ended_at: '2026-04-14T09:30:00.000Z',
        set_count: 12,
      },
      {
        id: 'w2',
        name: 'Push Day',
        started_at: '2026-04-10T08:00:00.000Z',
        ended_at: '2026-04-10T09:00:00.000Z',
        set_count: 8,
      },
    ]);
    const timeline = await getUnifiedTimeline('user1', 30, {
      now: new Date('2026-04-16T12:00:00.000Z'),
    });
    expect(timeline.map((e) => e.id)).toEqual(['workout:w1', 'workout:w2']);
    expect(timeline[0].type).toBe('workout');
    expect(timeline[0].title).toBe('Leg Day');
    expect(timeline[0].href).toContain('workout-insights');
    expect(timeline[0].subtitle).toContain('1h 30m');
    expect(timeline[0].subtitle).toContain('12 sets');
  });

  it('merges scan sessions with workouts by date', async () => {
    dbGetAll.mockResolvedValueOnce([
      {
        id: 'w1',
        name: 'Legs',
        started_at: '2026-04-15T08:00:00.000Z',
        ended_at: null,
        set_count: 0,
      },
    ]);
    const timeline = await getUnifiedTimeline('user1', 30, {
      now: new Date('2026-04-16T12:00:00.000Z'),
      scanSessions: [
        {
          id: 'scan1',
          startedAt: '2026-04-15T09:00:00.000Z',
          label: 'Squat scan',
        },
        {
          id: 'scan2',
          startedAt: '2026-04-16T07:00:00.000Z',
          label: 'Push-up scan',
        },
      ],
    });
    expect(timeline.map((e) => e.id)).toEqual([
      'scan:scan2',
      'scan:scan1',
      'workout:w1',
    ]);
    const scan = timeline.find((e) => e.id === 'scan:scan1');
    expect(scan?.type).toBe('scan');
    expect(scan?.title).toBe('Squat scan');
    expect(scan?.href).toBe('');
  });

  it('subtitle reads "In progress" when ended_at is null', async () => {
    dbGetAll.mockResolvedValueOnce([
      {
        id: 'w1',
        name: null,
        started_at: '2026-04-16T08:00:00.000Z',
        ended_at: null,
        set_count: 0,
      },
    ]);
    const timeline = await getUnifiedTimeline('user1', 30, {
      now: new Date('2026-04-16T12:00:00.000Z'),
    });
    expect(timeline[0].subtitle).toContain('In progress');
    expect(timeline[0].title).toBe('Workout session'); // default when name null
  });

  it('filters scan sessions older than the window', async () => {
    dbGetAll.mockResolvedValueOnce([]);
    const timeline = await getUnifiedTimeline('user1', 7, {
      now: new Date('2026-04-16T12:00:00.000Z'),
      scanSessions: [
        {
          id: 'recent',
          startedAt: '2026-04-15T00:00:00.000Z',
        },
        {
          id: 'stale',
          startedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });
    expect(timeline.map((e) => e.sourceId)).toEqual(['recent']);
  });

  it('returns an empty array when SQL throws', async () => {
    dbGetAll.mockRejectedValueOnce(new Error('db offline'));
    const timeline = await getUnifiedTimeline('user1', 30);
    expect(timeline).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupByDateBucket
// ---------------------------------------------------------------------------

describe('groupByDateBucket', () => {
  const now = new Date('2026-04-16T12:00:00.000Z');

  function mkEntry(
    id: string,
    occurredAt: string,
    type: 'workout' | 'scan' = 'workout',
  ): TimelineEntry {
    return {
      id,
      type,
      occurredAt,
      title: id,
      subtitle: null,
      href: '',
      sourceId: id,
    };
  }

  it('splits entries into non-empty sections labelled newest-first', () => {
    const entries = [
      mkEntry('today', '2026-04-16T09:00:00.000Z'),
      mkEntry('yday', '2026-04-15T09:00:00.000Z'),
      mkEntry('week', '2026-04-12T09:00:00.000Z'),
      mkEntry('older', '2026-02-01T09:00:00.000Z'),
    ];
    const sections = groupByDateBucket(entries, now);
    expect(sections.map((s) => s.bucket)).toEqual([
      'today',
      'yesterday',
      'this_week',
      'older',
    ]);
    expect(sections[0].label).toBe('Today');
    expect(sections[0].entries[0].id).toBe('today');
  });

  it('drops empty buckets', () => {
    const entries = [mkEntry('a', '2026-04-16T00:00:00.000Z')];
    const sections = groupByDateBucket(entries, now);
    expect(sections).toHaveLength(1);
    expect(sections[0].bucket).toBe('today');
  });

  it('returns an empty array for empty input', () => {
    expect(groupByDateBucket([], now)).toEqual([]);
  });

  it('preserves entry order within a bucket', () => {
    const entries = [
      mkEntry('a', '2026-04-16T10:00:00.000Z'),
      mkEntry('b', '2026-04-16T08:00:00.000Z'),
    ];
    const sections = groupByDateBucket(entries, now);
    expect(sections[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
