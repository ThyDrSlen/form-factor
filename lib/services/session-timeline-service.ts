/**
 * Session Timeline Service
 *
 * Builds a unified chronological timeline of workout sessions and
 * scan-arkit sessions for display in the session-timeline modal.
 *
 * Scan-arkit sessions are NOT currently persisted to any durable store
 * in this codebase (verified against `lib/` and `app/(tabs)/scan-arkit.tsx`
 * on 2026-04-16 — scan sessions live only in runtime state). Rather
 * than fabricate data, this service treats scan sessions as an optional
 * input: when a future scan-persistence layer lands (see TODO below),
 * it can feed rows into `options.scanSessions` and the merge will
 * continue to work unchanged.
 *
 * TODO(scan-persistence): add a dedicated `scan_sessions` table or
 * AsyncStorage journal, then populate `options.scanSessions` from it
 * inside the hook that calls this service.
 */
import { localDB } from '@/lib/services/database/local-db';

// =============================================================================
// Public types
// =============================================================================

export type TimelineEntryType = 'workout' | 'scan';

export interface TimelineEntry {
  /** Stable id for FlatList keyExtractor — prefixed with type for uniqueness. */
  id: string;
  /** Discriminant for rendering. */
  type: TimelineEntryType;
  /** ISO timestamp for sorting + grouping. */
  occurredAt: string;
  /** Short title (session name or exercise label). */
  title: string;
  /** One-line subtitle (duration, set count, FQI score, etc.). */
  subtitle: string | null;
  /**
   * Route for drill-in navigation (e.g.
   * `/(modals)/workout-insights?sessionId=…`). Empty string when the
   * underlying detail screen does not exist yet (see scan TODO).
   */
  href: string;
  /** Underlying id of the backing record (pre-fix). */
  sourceId: string;
}

export interface ScanTimelineInput {
  id: string;
  startedAt: string;
  /** Optional human label (exercise name or "Form scan"). */
  label?: string | null;
  /** Optional subtitle (e.g. "4 reps · FQI 82"). */
  subtitle?: string | null;
}

export type DateBucket =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'older';

export interface TimelineSection {
  bucket: DateBucket;
  label: string;
  entries: TimelineEntry[];
}

export interface GetUnifiedTimelineOptions {
  /** External scan sessions to merge (until persistence lands). */
  scanSessions?: ScanTimelineInput[];
  /** Override "now" for deterministic date-bucket tests. */
  now?: Date;
}

// =============================================================================
// Date bucketing
// =============================================================================

const BUCKET_LABELS: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  older: 'Older',
};

/** Public for tests — deterministic day-delta bucketing. */
export function classifyBucket(
  occurredAt: string,
  now: Date = new Date(),
): DateBucket {
  const occurred = Date.parse(occurredAt);
  if (!Number.isFinite(occurred)) return 'older';
  const diffMs = now.getTime() - occurred;
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / dayMs);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'this_week';
  if (diffDays < 14) return 'last_week';
  if (diffDays < 30) return 'this_month';
  return 'older';
}

// =============================================================================
// Internal queries
// =============================================================================

interface WorkoutSessionTimelineRow {
  id: string;
  name: string | null;
  started_at: string;
  ended_at: string | null;
  set_count: number;
}

async function readWorkoutSessions(
  sinceIso: string,
): Promise<WorkoutSessionTimelineRow[]> {
  const db = localDB.db;
  if (!db) return [];
  try {
    return await db.getAllAsync<WorkoutSessionTimelineRow>(
      `SELECT ws.id, ws.name, ws.started_at, ws.ended_at,
              (SELECT COUNT(*) FROM workout_session_sets wss
                 JOIN workout_session_exercises wse
                   ON wse.id = wss.session_exercise_id
                WHERE wse.session_id = ws.id AND wss.deleted = 0 AND wse.deleted = 0) AS set_count
         FROM workout_sessions ws
        WHERE ws.deleted = 0 AND ws.started_at >= ?
        ORDER BY ws.started_at DESC`,
      [sinceIso],
    );
  } catch {
    return [];
  }
}

function formatWorkoutSubtitle(row: WorkoutSessionTimelineRow): string {
  const parts: string[] = [];
  if (row.ended_at) {
    const durationMs =
      Date.parse(row.ended_at) - Date.parse(row.started_at);
    if (Number.isFinite(durationMs) && durationMs > 0) {
      const mins = Math.round(durationMs / 60000);
      parts.push(mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`);
    }
  } else {
    parts.push('In progress');
  }
  if (row.set_count > 0) {
    parts.push(`${row.set_count} set${row.set_count === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

function mapWorkoutRow(row: WorkoutSessionTimelineRow): TimelineEntry {
  return {
    id: `workout:${row.id}`,
    type: 'workout',
    occurredAt: row.started_at,
    title: row.name ?? 'Workout session',
    subtitle: formatWorkoutSubtitle(row) || null,
    href: `/(modals)/workout-insights?sessionId=${row.id}`,
    sourceId: row.id,
  };
}

function mapScanRow(row: ScanTimelineInput): TimelineEntry {
  return {
    id: `scan:${row.id}`,
    type: 'scan',
    occurredAt: row.startedAt,
    title: row.label ?? 'Form scan',
    subtitle: row.subtitle ?? null,
    // TODO(scan-persistence): once a detail screen exists, set this to
    // /(modals)/scan-session-detail?sessionId={row.id}
    href: '',
    sourceId: row.id,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Merge workout + scan sessions for the last `days` days into a single
 * timeline. Result is sorted newest-first and tagged by type.
 */
export async function getUnifiedTimeline(
  _userId: string,
  days: number = 30,
  options: GetUnifiedTimelineOptions = {},
): Promise<TimelineEntry[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const [workoutRows, scanEntries] = await Promise.all([
    readWorkoutSessions(sinceIso),
    Promise.resolve(options.scanSessions ?? []),
  ]);

  const workoutEntries = workoutRows.map(mapWorkoutRow);
  const mappedScan = scanEntries
    .filter((s) => Date.parse(s.startedAt) >= since.getTime())
    .map(mapScanRow);

  const merged = [...workoutEntries, ...mappedScan];
  return merged.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/**
 * Group timeline entries into date buckets (Today / Yesterday / This
 * week / Last week / This month / Older). Preserves the newest-first
 * ordering within each bucket and drops empty buckets.
 */
export function groupByDateBucket(
  entries: TimelineEntry[],
  now: Date = new Date(),
): TimelineSection[] {
  const bucketOrder: DateBucket[] = [
    'today',
    'yesterday',
    'this_week',
    'last_week',
    'this_month',
    'older',
  ];
  const map = new Map<DateBucket, TimelineEntry[]>();
  for (const b of bucketOrder) map.set(b, []);
  for (const entry of entries) {
    const bucket = classifyBucket(entry.occurredAt, now);
    const bucketEntries = map.get(bucket);
    if (bucketEntries) bucketEntries.push(entry);
  }
  return bucketOrder
    .map((bucket) => ({
      bucket,
      label: BUCKET_LABELS[bucket],
      entries: map.get(bucket) ?? [],
    }))
    .filter((section) => section.entries.length > 0);
}
