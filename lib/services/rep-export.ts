/**
 * Rep Export Service
 *
 * Serialises rep-level telemetry to CSV or JSON and (when available) hands it to
 * the platform share sheet via `expo-sharing`.
 *
 * NOTE: `expo-sharing` is not currently in `package.json`, so `shareRepData`
 * falls back to writing a temp file via `expo-file-system` and returning its
 * uri. The consumer component can then render a "Copy link" / "Open" fallback.
 * Once `expo-sharing` is added as a dependency, the dynamic import inside
 * `shareRepData` will Just Work.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { errorWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export type ExportFormat = 'csv' | 'json';

export interface RepExportScope {
  sessionId?: string;
  exerciseId?: string;
  /** Day window when sessionId is not provided. Defaults to 30. */
  days?: number;
}

export interface ExportedRepRow {
  rep_id: string;
  session_id: string;
  exercise: string;
  rep_index: number;
  side: string | null;
  start_ts: string;
  end_ts: string;
  duration_ms: number;
  fqi: number | null;
  rom_deg: number | null;
  depth_ratio: number | null;
  peak_velocity: number | null;
  valgus_peak: number | null;
  lumbar_flexion_peak: number | null;
  faults_detected: string;
  cues_emitted: string;
}

export interface ShareResult {
  /** The serialised payload (always returned). */
  payload: string;
  /** Absolute file uri (always returned when FileSystem is available). */
  fileUri: string | null;
  /**
   * True when the platform share sheet was actually invoked. False when
   * `expo-sharing` is not installed or sharing is unavailable on the current
   * platform.
   */
  shared: boolean;
  filename: string;
  mimeType: string;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** ISO timestamp for `now - days` */
function cutoffIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function featureNumber(features: unknown, key: string): number | null {
  if (!features || typeof features !== 'object') return null;
  const rec = features as Record<string, unknown>;
  const v = rec[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function toExportRow(raw: Record<string, unknown>): ExportedRepRow {
  const start = typeof raw.start_ts === 'string' ? raw.start_ts : '';
  const end = typeof raw.end_ts === 'string' ? raw.end_ts : '';
  const duration = start && end ? new Date(end).getTime() - new Date(start).getTime() : 0;
  return {
    rep_id: typeof raw.rep_id === 'string' ? raw.rep_id : '',
    session_id: typeof raw.session_id === 'string' ? raw.session_id : '',
    exercise: typeof raw.exercise === 'string' ? raw.exercise : '',
    rep_index: typeof raw.rep_index === 'number' ? raw.rep_index : 0,
    side: typeof raw.side === 'string' ? raw.side : null,
    start_ts: start,
    end_ts: end,
    duration_ms: Number.isFinite(duration) && duration > 0 ? duration : 0,
    fqi: typeof raw.fqi === 'number' ? raw.fqi : null,
    rom_deg: featureNumber(raw.features, 'romDeg') ?? featureNumber(raw.features, 'rom_deg'),
    depth_ratio: featureNumber(raw.features, 'depthRatio') ?? featureNumber(raw.features, 'depth_ratio'),
    peak_velocity: featureNumber(raw.features, 'peakVelocity') ?? featureNumber(raw.features, 'peak_velocity'),
    valgus_peak: featureNumber(raw.features, 'valgusPeak') ?? featureNumber(raw.features, 'valgus_peak'),
    lumbar_flexion_peak:
      featureNumber(raw.features, 'lumbarFlexionPeak') ?? featureNumber(raw.features, 'lumbar_flexion_peak'),
    faults_detected: Array.isArray(raw.faults_detected) ? (raw.faults_detected as string[]).join('|') : '',
    cues_emitted: Array.isArray(raw.cues_emitted)
      ? (raw.cues_emitted as { type?: string }[])
          .map((c) => (typeof c?.type === 'string' ? c.type : ''))
          .filter(Boolean)
          .join('|')
      : '',
  };
}

async function fetchReps(scope: RepExportScope): Promise<ExportedRepRow[]> {
  let query = supabase
    .from('reps')
    .select('rep_id,session_id,exercise,rep_index,side,start_ts,end_ts,fqi,features,faults_detected,cues_emitted');

  if (scope.sessionId) {
    query = query.eq('session_id', scope.sessionId);
  } else {
    const days = Number.isFinite(scope.days) && scope.days! > 0 ? (scope.days as number) : 30;
    query = query.gte('start_ts', cutoffIso(days));
  }
  if (scope.exerciseId) {
    query = query.eq('exercise', scope.exerciseId);
  }

  const { data, error } = await query.order('start_ts', { ascending: true }).limit(5000);
  if (error) throw error;

  return (data ?? []).map((raw) => toExportRow(raw as Record<string, unknown>));
}

export const CSV_COLUMNS: (keyof ExportedRepRow)[] = [
  'rep_id',
  'session_id',
  'exercise',
  'rep_index',
  'side',
  'start_ts',
  'end_ts',
  'duration_ms',
  'fqi',
  'rom_deg',
  'depth_ratio',
  'peak_velocity',
  'valgus_peak',
  'lumbar_flexion_peak',
  'faults_detected',
  'cues_emitted',
];

export function serializeCsv(rows: ExportedRepRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const body = rows
    .map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col] as string | number | null)).join(','))
    .join('\n');
  return body.length === 0 ? `${header}\n` : `${header}\n${body}\n`;
}

export function serializeJson(rows: ExportedRepRow[], scope: RepExportScope): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      scope,
      rowCount: rows.length,
      rows,
    },
    null,
    2,
  );
}

export function buildFilename(scope: RepExportScope, format: ExportFormat): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scopeParts: string[] = [];
  if (scope.sessionId) scopeParts.push(`session-${scope.sessionId.slice(0, 8)}`);
  if (scope.exerciseId) scopeParts.push(`ex-${scope.exerciseId.slice(0, 12)}`);
  if (!scopeParts.length) scopeParts.push(`last-${scope.days ?? 30}d`);
  return `reps-${scopeParts.join('-')}-${timestamp}.${format}`;
}

export function mimeTypeFor(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv' : 'application/json';
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch reps matching `scope` and return the serialised payload.
 */
export async function exportRepData(scope: RepExportScope, format: ExportFormat): Promise<string> {
  try {
    const rows = await fetchReps(scope);
    return format === 'csv' ? serializeCsv(rows) : serializeJson(rows, scope);
  } catch (error) {
    errorWithTs('[rep-export] exportRepData failed', error);
    // Return a valid empty payload rather than throwing so callers can
    // still show a user-visible "no data" state without crashing.
    return format === 'csv' ? `${CSV_COLUMNS.join(',')}\n` : serializeJson([], scope);
  }
}

/**
 * Serialise + write to a temp file, then try to open the share sheet.
 * When `expo-sharing` is not installed the function still returns the file uri
 * so the consumer UI can render a copy/open fallback.
 */
export async function shareRepData(scope: RepExportScope, format: ExportFormat): Promise<ShareResult> {
  const payload = await exportRepData(scope, format);
  const filename = buildFilename(scope, format);
  const mimeType = mimeTypeFor(format);

  let fileUri: string | null = null;
  try {
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (dir) {
      fileUri = `${dir}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, payload, { encoding: 'utf8' as FileSystem.EncodingType });
    }
  } catch (error) {
    errorWithTs('[rep-export] writeAsStringAsync failed', error);
    fileUri = null;
  }

  let shared = false;
  try {
    // Use a dynamic require so the bundler does not fail when expo-sharing
    // is absent. We still narrow the type to a minimal shape.
    const sharing = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-sharing') as {
          isAvailableAsync?: () => Promise<boolean>;
          shareAsync?: (url: string, options?: { mimeType?: string }) => Promise<void>;
        };
      } catch {
        return null;
      }
    })();

    if (sharing && fileUri && typeof sharing.isAvailableAsync === 'function' && typeof sharing.shareAsync === 'function') {
      const available = await sharing.isAvailableAsync();
      if (available) {
        await sharing.shareAsync(fileUri, { mimeType });
        shared = true;
      }
    }
  } catch (error) {
    errorWithTs('[rep-export] share invocation failed', error);
  }

  return {
    payload,
    fileUri,
    shared,
    filename,
    mimeType,
  };
}
