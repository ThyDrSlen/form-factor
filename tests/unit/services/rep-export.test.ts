import { supabase } from '@/lib/supabase';
import {
  exportRepData,
  shareRepData,
  serializeCsv,
  serializeJson,
  buildFilename,
  CSV_COLUMNS,
} from '@/lib/services/rep-export';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockWriteAsStringAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///tmp/test/',
  documentDirectory: 'file:///tmp/test-doc/',
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsStringAsync(...args),
  EncodingType: { UTF8: 'utf8' },
}));

const mockShareAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
  isAvailableAsync: () => mockIsAvailableAsync(),
}), { virtual: true });

const mockFrom = supabase.from as jest.Mock;

function createMockQuery(data: any, error: any = null) {
  const resolved = { data, error };
  const query: Record<string, any> = {};
  ['select', 'eq', 'gte', 'order', 'limit'].forEach((method) => {
    query[method] = jest.fn().mockReturnValue(query);
  });
  Object.defineProperty(query, 'then', {
    value: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(resolved).then(onFulfilled, onRejected),
  });
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAsStringAsync.mockResolvedValue(undefined);
  mockIsAvailableAsync.mockResolvedValue(true);
  mockShareAsync.mockResolvedValue(undefined);
});

// =============================================================================
// exportRepData — CSV
// =============================================================================

describe('exportRepData (csv)', () => {
  it('emits the full column header even when there are no rows', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));

    const out = await exportRepData({ sessionId: 'sess-1' }, 'csv');

    expect(out.startsWith(CSV_COLUMNS.join(','))).toBe(true);
    // No data rows -> just header + newline
    expect(out.trim().split('\n')).toHaveLength(1);
  });

  it('flattens features and joins faults/cues with pipe delimiter', async () => {
    const row = {
      rep_id: 'rep-1',
      session_id: 'sess-1',
      exercise: 'squat',
      rep_index: 1,
      side: null,
      start_ts: '2026-04-01T00:00:00.000Z',
      end_ts: '2026-04-01T00:00:02.500Z',
      fqi: 82,
      features: { romDeg: 112, depthRatio: 0.95, peakVelocity: 1.2, valgusPeak: 4.5 },
      faults_detected: ['valgus_collapse', 'shallow_depth'],
      cues_emitted: [{ type: 'knee_push', ts: '2026-04-01T00:00:01.000Z' }],
    };
    mockFrom.mockReturnValue(createMockQuery([row]));

    const out = await exportRepData({ sessionId: 'sess-1' }, 'csv');

    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    const header = lines[0].split(',');
    const values = lines[1].split(',');
    const get = (col: string) => values[header.indexOf(col)];

    expect(get('rep_id')).toBe('rep-1');
    expect(get('fqi')).toBe('82');
    expect(get('rom_deg')).toBe('112');
    expect(get('depth_ratio')).toBe('0.95');
    expect(get('peak_velocity')).toBe('1.2');
    expect(get('valgus_peak')).toBe('4.5');
    expect(get('duration_ms')).toBe('2500');
    // pipe-joined with quotes only if special chars present; our faults have no commas
    expect(get('faults_detected')).toBe('valgus_collapse|shallow_depth');
    expect(get('cues_emitted')).toBe('knee_push');
  });
});

// =============================================================================
// exportRepData — JSON
// =============================================================================

describe('exportRepData (json)', () => {
  it('wraps rows in an envelope with scope + rowCount + exportedAt', async () => {
    const row = {
      rep_id: 'rep-1',
      session_id: 'sess-1',
      exercise: 'squat',
      rep_index: 1,
      side: 'left',
      start_ts: '2026-04-01T00:00:00.000Z',
      end_ts: '2026-04-01T00:00:02.000Z',
      fqi: 80,
      features: { romDeg: 100 },
      faults_detected: [],
      cues_emitted: [],
    };
    mockFrom.mockReturnValue(createMockQuery([row]));

    const out = await exportRepData({ exerciseId: 'squat', days: 14 }, 'json');
    const parsed = JSON.parse(out);

    expect(parsed.scope).toEqual({ exerciseId: 'squat', days: 14 });
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].rep_id).toBe('rep-1');
    expect(parsed.rows[0].rom_deg).toBe(100);
    expect(parsed.rows[0].duration_ms).toBe(2000);
    expect(typeof parsed.exportedAt).toBe('string');
  });

  it('serializeCsv + serializeJson helpers round-trip cleanly on zero rows', () => {
    expect(serializeCsv([]).trim()).toBe(CSV_COLUMNS.join(','));
    const json = JSON.parse(serializeJson([], { sessionId: 'sess-abc' }));
    expect(json.rowCount).toBe(0);
    expect(json.rows).toEqual([]);
  });
});

// =============================================================================
// shareRepData
// =============================================================================

describe('shareRepData', () => {
  it('writes the payload to disk and invokes expo-sharing when available', async () => {
    mockFrom.mockReturnValue(createMockQuery([]));

    const result = await shareRepData({ sessionId: 'sess-1' }, 'csv');

    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    const [uri, payload, opts] = mockWriteAsStringAsync.mock.calls[0];
    expect(typeof uri).toBe('string');
    expect(uri.endsWith('.csv')).toBe(true);
    expect(payload.startsWith(CSV_COLUMNS.join(','))).toBe(true);
    expect(opts).toEqual({ encoding: 'utf8' });

    expect(mockIsAvailableAsync).toHaveBeenCalledTimes(1);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(result.shared).toBe(true);
    expect(result.filename.endsWith('.csv')).toBe(true);
    expect(result.mimeType).toBe('text/csv');
  });

  it('still returns a payload when sharing is unavailable', async () => {
    mockIsAvailableAsync.mockResolvedValueOnce(false);
    mockFrom.mockReturnValue(createMockQuery([]));

    const result = await shareRepData({ exerciseId: 'squat', days: 7 }, 'json');

    expect(result.shared).toBe(false);
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(result.payload.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe('application/json');
  });
});

// =============================================================================
// buildFilename
// =============================================================================

describe('buildFilename', () => {
  it('includes scope hint in the filename', () => {
    const sessionFile = buildFilename({ sessionId: 'abcdef123456' }, 'csv');
    expect(sessionFile).toMatch(/^reps-session-abcdef12-.*\.csv$/);

    const exerciseFile = buildFilename({ exerciseId: 'squat' }, 'json');
    expect(exerciseFile).toMatch(/^reps-ex-squat-.*\.json$/);

    const rollingFile = buildFilename({ days: 14 }, 'csv');
    expect(rollingFile).toMatch(/^reps-last-14d-.*\.csv$/);
  });
});
