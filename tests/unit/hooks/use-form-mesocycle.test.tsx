import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockEnsureUserId = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock('@/lib/auth-utils', () => ({
  ensureUserId: () => mockEnsureUserId(),
}));

interface QueryBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  gte: jest.Mock;
}

function makeQueryBuilder(response: { data?: unknown; error?: unknown } = {}): QueryBuilder {
  const builder: QueryBuilder = {
    select: jest.fn(),
    eq: jest.fn(),
    gte: jest.fn(() =>
      Promise.resolve({ data: response.data ?? [], error: response.error ?? null }),
    ),
  };
  builder.select.mockImplementation(() => builder);
  builder.eq.mockImplementation(() => builder);
  return builder;
}

import { useFormMesocycle } from '@/hooks/use-form-mesocycle';

beforeEach(() => {
  mockEnsureUserId.mockReset();
  mockFrom.mockReset();
  mockEnsureUserId.mockResolvedValue('user-1');
});

describe('useFormMesocycle', () => {
  it('loads reps + sets and returns insights on success', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reps') {
        return makeQueryBuilder({
          data: [
            {
              rep_id: 'r1',
              session_id: 's1',
              exercise: 'squat',
              start_ts: new Date().toISOString(),
              fqi: 82,
              faults_detected: ['valgus'],
            },
          ],
        });
      }
      if (table === 'sets') {
        return makeQueryBuilder({
          data: [
            {
              set_id: 'st1',
              session_id: 's1',
              exercise: 'squat',
              created_at: new Date().toISOString(),
              reps_count: 5,
              load_value: 225,
            },
          ],
        });
      }
      return makeQueryBuilder();
    });

    const { result } = renderHook(() => useFormMesocycle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.insights).not.toBeNull();
    expect(result.current.insights?.isEmpty).toBe(false);
    expect(result.current.insights?.topFaults.length).toBeGreaterThan(0);
  });

  it('treats per-table query errors as empty data rather than surfacing a page error', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reps') return makeQueryBuilder({ error: new Error('reps boom') });
      return makeQueryBuilder();
    });

    const { result } = renderHook(() => useFormMesocycle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.insights?.isEmpty).toBe(true);
  });

  it('surfaces a page error when ensureUserId throws', async () => {
    mockEnsureUserId.mockRejectedValueOnce(new Error('no auth'));
    mockFrom.mockImplementation(() => makeQueryBuilder());

    const { result } = renderHook(() => useFormMesocycle());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('no auth');
    expect(result.current.insights).toBeNull();
  });

  it('re-runs the queries when refresh() is called', async () => {
    mockFrom.mockImplementation(() => makeQueryBuilder());
    const { result } = renderHook(() => useFormMesocycle());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const initialCalls = mockFrom.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockFrom.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it('aborts state updates after unmount', async () => {
    let resolveReps: ((value: { data: unknown[]; error: null }) => void) | undefined;
    const pendingReps = new Promise((resolve) => {
      resolveReps = resolve as typeof resolveReps;
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'reps') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => pendingReps,
            }),
          }),
        };
      }
      return makeQueryBuilder();
    });

    const { result, unmount } = renderHook(() => useFormMesocycle());
    unmount();

    // Resolve the in-flight query after unmount — the hook must not blow up
    // and must not flip `loading` on a ghost copy.
    await act(async () => {
      resolveReps?.({ data: [], error: null });
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
  });
});
