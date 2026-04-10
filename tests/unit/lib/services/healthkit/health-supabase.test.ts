/**
 * Tests for lib/services/healthkit/health-supabase.ts
 *
 * fetchSupabaseHealthSnapshot: Supabase query, date parsing, buildHistory carry-forward.
 */

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// Build a chainable Supabase mock
const mockSupabaseData: { data: any[] | null; error: any } = { data: null, error: null };

const mockSupabaseChain = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  order: jest.fn().mockImplementation(() => mockSupabaseData),
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => mockSupabaseChain),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

import { fetchSupabaseHealthSnapshot } from '@/lib/services/healthkit/health-supabase';

describe('health-supabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseData.data = null;
    mockSupabaseData.error = null;
  });

  describe('fetchSupabaseHealthSnapshot', () => {
    it('returns null for empty userId', async () => {
      const result = await fetchSupabaseHealthSnapshot('');
      expect(result).toBeNull();
    });

    it('returns null for null-ish userId', async () => {
      const result = await fetchSupabaseHealthSnapshot('' as any);
      expect(result).toBeNull();
    });

    it('returns null when Supabase returns an error', async () => {
      mockSupabaseData.error = { message: 'unauthorized' };
      mockSupabaseData.data = null;

      const result = await fetchSupabaseHealthSnapshot('user-1');
      expect(result).toBeNull();
    });

    it('returns null when Supabase returns empty data', async () => {
      mockSupabaseData.data = [];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1');
      expect(result).toBeNull();
    });

    it('returns null when Supabase returns null data', async () => {
      mockSupabaseData.data = null;
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1');
      expect(result).toBeNull();
    });

    it('builds a snapshot from valid rows', async () => {
      mockSupabaseData.data = [
        {
          summary_date: '2024-01-01',
          steps: 5000,
          heart_rate_bpm: 70,
          heart_rate_timestamp: '2024-01-01T12:00:00Z',
          weight_kg: 75.5,
          weight_timestamp: '2024-01-01T08:00:00Z',
          recorded_at: '2024-01-01T23:00:00Z',
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      expect(result).not.toBeNull();
      expect(result!.steps).toBe(5000);
      expect(result!.heartRateBpm).toBe(70);
      expect(result!.heartRateTimestamp).toEqual(expect.any(Number));
      expect(result!.weightKg).toBe(75.5);
      expect(result!.weightTimestamp).toEqual(expect.any(Number));
      expect(result!.lastUpdatedAt).toEqual(expect.any(Number));
    });

    it('builds step history with zero-fill for missing days', async () => {
      // Use today's date so it falls within the generated range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().slice(0, 10);

      mockSupabaseData.data = [
        {
          summary_date: todayStr,
          steps: 8000,
          heart_rate_bpm: null,
          heart_rate_timestamp: null,
          weight_kg: null,
          weight_timestamp: null,
          recorded_at: null,
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      expect(result).not.toBeNull();
      expect(result!.stepHistory).toEqual(expect.any(Array));
      expect(result!.stepHistory.length).toBe(7);
      // Steps should have data for today's date
      const hasStepData = result!.stepHistory.some(p => p.value === 8000);
      expect(hasStepData).toBe(true);
    });

    it('builds weight history with carry-forward', async () => {
      mockSupabaseData.data = [
        {
          summary_date: '2024-01-01',
          steps: null,
          heart_rate_bpm: null,
          heart_rate_timestamp: null,
          weight_kg: 75.0,
          weight_timestamp: '2024-01-01T08:00:00Z',
          recorded_at: null,
        },
        {
          summary_date: '2024-01-03',
          steps: null,
          heart_rate_bpm: null,
          heart_rate_timestamp: null,
          weight_kg: 74.5,
          weight_timestamp: '2024-01-03T08:00:00Z',
          recorded_at: null,
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      expect(result).not.toBeNull();
      expect(result!.weightHistory.length).toBe(7);
      // Weight values should be carried forward between data points
      result!.weightHistory.forEach(p => {
        expect(p.value).toEqual(expect.any(Number));
      });
    });

    it('uses latest row for scalar values', async () => {
      mockSupabaseData.data = [
        {
          summary_date: '2024-01-01',
          steps: 3000,
          heart_rate_bpm: 65,
          heart_rate_timestamp: null,
          weight_kg: 75.0,
          weight_timestamp: null,
          recorded_at: null,
        },
        {
          summary_date: '2024-01-02',
          steps: 7000,
          heart_rate_bpm: 72,
          heart_rate_timestamp: null,
          weight_kg: 74.8,
          weight_timestamp: null,
          recorded_at: null,
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      expect(result).not.toBeNull();
      // Should use the last row's values (2024-01-02)
      expect(result!.steps).toBe(7000);
      expect(result!.heartRateBpm).toBe(72);
      expect(result!.weightKg).toBe(74.8);
    });

    it('handles null steps in latest row', async () => {
      mockSupabaseData.data = [
        {
          summary_date: '2024-01-01',
          steps: null,
          heart_rate_bpm: null,
          heart_rate_timestamp: null,
          weight_kg: null,
          weight_timestamp: null,
          recorded_at: null,
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      expect(result).not.toBeNull();
      expect(result!.steps).toBeNull();
      expect(result!.heartRateBpm).toBeNull();
      expect(result!.weightKg).toBeNull();
    });

    it('handles invalid date in summary_date', async () => {
      mockSupabaseData.data = [
        {
          summary_date: 'not-a-date',
          steps: 5000,
          heart_rate_bpm: null,
          heart_rate_timestamp: null,
          weight_kg: null,
          weight_timestamp: null,
          recorded_at: null,
        },
      ];
      mockSupabaseData.error = null;

      const result = await fetchSupabaseHealthSnapshot('user-1', 7);
      // Should still return a result but the row may not be in the map
      expect(result).not.toBeNull();
    });

    it('queries with correct parameters', async () => {
      const { supabase } = require('@/lib/supabase');
      mockSupabaseData.data = [];
      mockSupabaseData.error = null;

      await fetchSupabaseHealthSnapshot('user-123', 7);

      expect(supabase.from).toHaveBeenCalledWith('health_metrics');
      expect(mockSupabaseChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mockSupabaseChain.order).toHaveBeenCalledWith('summary_date', { ascending: true });
    });
  });
});
