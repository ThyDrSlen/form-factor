// ---------------------------------------------------------------------------
// Supabase + notifications mocks — hoisted, self-contained factories.
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown; error: unknown };
declare global {
  // eslint-disable-next-line no-var
  var __schedulerResult: QueryResult;
}
(globalThis as unknown as { __schedulerResult: QueryResult }).__schedulerResult = {
  data: [],
  error: null,
};

function setRows(rows: Array<Record<string, unknown>>) {
  (globalThis as unknown as { __schedulerResult: QueryResult }).__schedulerResult = {
    data: rows,
    error: null,
  };
}
function setQueryError(error: { code?: string; message: string }) {
  (globalThis as unknown as { __schedulerResult: QueryResult }).__schedulerResult = {
    data: null,
    error,
  };
}

jest.mock('@/lib/supabase', () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (
          onFulfilled?: ((v: unknown) => unknown) | null,
          onRejected?: ((e: unknown) => unknown) | null,
        ) =>
          Promise.resolve(
            (globalThis as { __schedulerResult: QueryResult }).__schedulerResult,
          ).then(onFulfilled ?? undefined, onRejected ?? undefined);
      }
      return () => new Proxy({}, handler);
    },
  };
  return {
    supabase: {
      from: () => new Proxy({}, handler),
    },
  };
});

const mockScheduleTemplatedReminder = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/notifications', () => ({
  scheduleTemplatedReminder: (...args: unknown[]) =>
    mockScheduleTemplatedReminder(...args),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  buildScanDeepLink,
  parseTemplateIdFromUrl,
  scheduleTemplatedWorkout,
  getNextScheduledTemplate,
  SCAN_DEEP_LINK_BASE,
} from '@/lib/services/workout-scheduler';

describe('workout-scheduler', () => {
  beforeEach(() => {
    mockScheduleTemplatedReminder.mockClear();
    setRows([]);
  });

  describe('buildScanDeepLink', () => {
    it('produces the documented URL shape', () => {
      const url = buildScanDeepLink('abc-123');
      expect(url).toBe(`${SCAN_DEEP_LINK_BASE}?templateId=abc-123`);
    });

    it('percent-encodes unsafe chars', () => {
      const url = buildScanDeepLink('a/b c');
      expect(url).toMatch(/templateId=a%2Fb%20c/);
    });
  });

  describe('parseTemplateIdFromUrl', () => {
    it('parses a full scheme URL', () => {
      expect(parseTemplateIdFromUrl('form-factor://scan?templateId=xyz')).toBe('xyz');
    });

    it('returns null for a URL without templateId', () => {
      expect(parseTemplateIdFromUrl('form-factor://scan')).toBeNull();
    });

    it('returns null for a different host', () => {
      expect(parseTemplateIdFromUrl('form-factor://coach?templateId=xyz')).toBeNull();
    });

    it('returns null for non-string / empty input', () => {
      expect(parseTemplateIdFromUrl('')).toBeNull();
      // @ts-expect-error — runtime guard
      expect(parseTemplateIdFromUrl(null)).toBeNull();
    });

    it('returns null for malformed URLs', () => {
      expect(parseTemplateIdFromUrl('not a url')).toBeNull();
    });

    it('accepts query-only strings', () => {
      expect(parseTemplateIdFromUrl('?templateId=abc')).toBe('abc');
    });
  });

  describe('scheduleTemplatedWorkout', () => {
    it('delegates to notifications.scheduleTemplatedReminder', async () => {
      const when = new Date(Date.now() + 60_000);
      await scheduleTemplatedWorkout('t1', when);
      expect(mockScheduleTemplatedReminder).toHaveBeenCalledWith('t1', when);
    });

    it('no-ops on empty templateId', async () => {
      await scheduleTemplatedWorkout('', new Date(Date.now() + 10_000));
      expect(mockScheduleTemplatedReminder).not.toHaveBeenCalled();
    });

    it('no-ops on invalid Date', async () => {
      await scheduleTemplatedWorkout('t1', new Date('not-a-date'));
      expect(mockScheduleTemplatedReminder).not.toHaveBeenCalled();
    });

    it('no-ops on past date', async () => {
      await scheduleTemplatedWorkout('t1', new Date(Date.now() - 60_000));
      expect(mockScheduleTemplatedReminder).not.toHaveBeenCalled();
    });

    it('survives notifications layer throwing', async () => {
      mockScheduleTemplatedReminder.mockRejectedValueOnce(new Error('boom'));
      await expect(
        scheduleTemplatedWorkout('t1', new Date(Date.now() + 60_000)),
      ).resolves.toBeUndefined();
    });
  });

  describe('getNextScheduledTemplate', () => {
    it('returns null when Supabase returns no rows', async () => {
      setRows([]);
      const r = await getNextScheduledTemplate('u1');
      expect(r).toBeNull();
    });

    it('returns null on Supabase error', async () => {
      setQueryError({ code: 'PGRST301', message: 'rls' });
      const r = await getNextScheduledTemplate('u1');
      expect(r).toBeNull();
    });

    it('returns null for empty userId', async () => {
      const r = await getNextScheduledTemplate('');
      expect(r).toBeNull();
    });

    it('returns the closest future scheduled date', async () => {
      const future1 = new Date(Date.now() + 60_000).toISOString();
      const future2 = new Date(Date.now() + 120_000).toISOString();
      const past = new Date(Date.now() - 60_000).toISOString();
      setRows([
        { id: 't1', user_id: 'u1', name: 'A', scheduled_next_dates: [future2] },
        { id: 't2', user_id: 'u1', name: 'B', scheduled_next_dates: [past, future1] },
      ]);
      const r = await getNextScheduledTemplate('u1');
      expect(r?.template.id).toBe('t2');
      expect(r?.scheduledAt.toISOString()).toBe(future1);
    });

    it('skips rows without scheduled_next_dates', async () => {
      setRows([
        { id: 't1', user_id: 'u1', name: 'A' },
        { id: 't2', user_id: 'u1', name: 'B', scheduled_next_dates: 'not-an-array' },
      ]);
      const r = await getNextScheduledTemplate('u1');
      expect(r).toBeNull();
    });

    it('ignores non-string / invalid ISO entries', async () => {
      setRows([
        {
          id: 't1',
          user_id: 'u1',
          name: 'A',
          scheduled_next_dates: [42, 'garbage', new Date(Date.now() + 60_000).toISOString()],
        },
      ]);
      const r = await getNextScheduledTemplate('u1');
      expect(r?.template.id).toBe('t1');
    });

    it('ignores dates in the past', async () => {
      setRows([
        {
          id: 't1',
          user_id: 'u1',
          name: 'A',
          scheduled_next_dates: [new Date(Date.now() - 1000).toISOString()],
        },
      ]);
      const r = await getNextScheduledTemplate('u1');
      expect(r).toBeNull();
    });
  });
});
