import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePersonalCoachingInsights } from '@/features/health/hooks/use-personal-coaching-insights';
import { listWorkoutSessionHistory, getWorkoutSessionHistoryDetail } from '@/lib/services/workout-session-history';
import { supabase } from '@/lib/supabase';

let mockUser: { id: string } | null = { id: 'alice' };
jest.mock('@/features/auth/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/services/workout-session-history', () => ({ listWorkoutSessionHistory: jest.fn(), getWorkoutSessionHistoryDetail: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
const mockRange = jest.fn();
const query = { select: jest.fn(), eq: jest.fn(), gte: jest.fn(), lt: jest.fn(), order: jest.fn(), range: mockRange };
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 'alice' };
  Object.entries(query).forEach(([name, fn]) => { if (name !== 'range') fn.mockReturnValue(query); });
  (supabase.from as jest.Mock).mockReturnValue(query);
  mockRange.mockResolvedValue({ data: [], error: null });
  (listWorkoutSessionHistory as jest.Mock).mockResolvedValue([{ id: 'owned', ended_at: new Date().toISOString() }]);
  (getWorkoutSessionHistoryDetail as jest.Mock).mockResolvedValue({ exercises: [{ sets: [6, 10, 3].map((actual_reps, i) => ({ id: `${i}`, set_type: 'normal', actual_reps })) }] });
});
it('reads authenticated existing records and calculates a real rule-based result', async () => {
  const { result } = renderHook(() => usePersonalCoachingInsights());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(listWorkoutSessionHistory).toHaveBeenCalledWith('alice');
  expect(getWorkoutSessionHistoryDetail).toHaveBeenCalledWith('alice', 'owned');
  expect(query.eq).toHaveBeenCalledWith('user_id', 'alice');
  expect(result.current.data?.training.score).toBe(67);
  expect(result.current.data?.learning.status).toBe('insufficient');
});
it('preserves local training feedback offline while marking form learning unavailable', async () => {
  mockRange.mockResolvedValue({ data: null, error: new Error('offline') });
  const { result } = renderHook(() => usePersonalCoachingInsights());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data?.training.score).toBe(67);
  expect(result.current.data?.warnings).toContain('Synced form history unavailable; no form association was calculated.');
});

it('paginates form history and rejects truncation instead of fitting partial sessions', async () => {
  const fullPage = Array.from({ length: 500 }, (_, i) => ({ rep_id: `${i}` }));
  mockRange.mockResolvedValueOnce({ data: fullPage, error: null }).mockResolvedValueOnce({ data: [], error: null });
  const { result } = renderHook(() => usePersonalCoachingInsights());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockRange).toHaveBeenCalledWith(500, 999);
  mockRange.mockResolvedValue({ data: fullPage, error: null });
  await act(async () => result.current.refresh());
  expect(result.current.data).toBeNull();
  expect(result.current.error).toContain('unavailable');
});

it('clears immediately on sign-out and ignores an old-owner async result', async () => {
  let resolve!: (value: unknown) => void;
  mockRange.mockReturnValue(new Promise(r => { resolve = r; }));
  const { result, rerender } = renderHook(() => usePersonalCoachingInsights());
  mockUser = null; rerender({});
  expect(result.current.data).toBeNull();
  await act(async () => resolve({ data: [], error: null }));
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(false);
});
