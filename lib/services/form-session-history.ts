/**
 * Form Session History
 *
 * Thin AsyncStorage-backed log of per-exercise session averages used by
 * the form-milestone detector. Intentionally lightweight — we store only
 * the fields required to run `detectMilestone()` against historical
 * sessions, not the full rep data (which lives in the local-db / supabase
 * pipeline).
 *
 * The log is capped at FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE to
 * keep storage bounded. Entries are newest-first.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FORM_SESSION_HISTORY_STORAGE_KEY = 'form_session_history_v1';
export const FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE = 30;

export interface FormSessionHistoryEntry {
  exerciseKey: string;
  avgFqi: number;
  endedAt: string;
  sessionId?: string;
}

type FormSessionHistoryByExercise = Record<string, FormSessionHistoryEntry[]>;

function safeParse(raw: string | null): FormSessionHistoryByExercise {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: FormSessionHistoryByExercise = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      out[key] = value.filter(isEntry);
    }
    return out;
  } catch {
    return {};
  }
}

function isEntry(value: unknown): value is FormSessionHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.exerciseKey === 'string' &&
    typeof v.avgFqi === 'number' &&
    Number.isFinite(v.avgFqi) &&
    typeof v.endedAt === 'string'
  );
}

export async function appendFormSessionHistory(
  entry: FormSessionHistoryEntry,
): Promise<void> {
  if (!entry.exerciseKey) return;
  if (!Number.isFinite(entry.avgFqi)) return;
  try {
    const raw = await AsyncStorage.getItem(FORM_SESSION_HISTORY_STORAGE_KEY);
    const parsed = safeParse(raw);
    const prior = parsed[entry.exerciseKey] ?? [];
    const next = [entry, ...prior].slice(
      0,
      FORM_SESSION_HISTORY_MAX_ENTRIES_PER_EXERCISE,
    );
    parsed[entry.exerciseKey] = next;
    await AsyncStorage.setItem(
      FORM_SESSION_HISTORY_STORAGE_KEY,
      JSON.stringify(parsed),
    );
  } catch {
    // best-effort — skipping the write just means the next session won't
    // see this milestone baseline.
  }
}

export async function getFormSessionHistory(
  exerciseKey: string,
): Promise<FormSessionHistoryEntry[]> {
  if (!exerciseKey) return [];
  try {
    const raw = await AsyncStorage.getItem(FORM_SESSION_HISTORY_STORAGE_KEY);
    const parsed = safeParse(raw);
    return parsed[exerciseKey] ?? [];
  } catch {
    return [];
  }
}

/** Load the full history blob across all exercises. Exposed for aggregates. */
export async function getAllFormSessionHistory(): Promise<FormSessionHistoryByExercise> {
  try {
    const raw = await AsyncStorage.getItem(FORM_SESSION_HISTORY_STORAGE_KEY);
    return safeParse(raw);
  } catch {
    return {};
  }
}

/**
 * Count PBs set so far this calendar month (inclusive of the caller-provided
 * `now`) across every exercise. A PB is any entry whose avgFqi strictly
 * exceeds every prior entry for the same exercise that occurred before it.
 *
 * When `candidate` is provided (and beats the running prior-best for that
 * exercise at `now` by `pbMargin`), the returned count includes +1 so the
 * caller can surface "3rd PB this month" before actually appending the
 * entry — avoids ordering dependencies between milestone emission and
 * history writes.
 */
export async function countPbsThisMonth(args: {
  now: Date;
  pbMargin?: number;
  candidate?: { exerciseKey: string; avgFqi: number };
}): Promise<number> {
  const { now, pbMargin = 2, candidate } = args;
  const all = await getAllFormSessionHistory();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
  let pbs = 0;
  for (const [exerciseKey, entries] of Object.entries(all)) {
    // Sort oldest→newest so each entry can be compared against the best
    // strictly before it. The first entry can never be a PB (no prior to
    // beat) — match the detector's first-session semantics.
    const sorted = [...entries].sort(
      (a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt),
    );
    let runningBest: number | null = null;
    for (const entry of sorted) {
      const ts = Date.parse(entry.endedAt);
      if (
        runningBest != null &&
        Number.isFinite(ts) &&
        ts >= firstOfMonth &&
        entry.avgFqi - runningBest >= pbMargin
      ) {
        pbs += 1;
      }
      if (runningBest == null || entry.avgFqi > runningBest) {
        runningBest = entry.avgFqi;
      }
    }
    // If the caller is evaluating a not-yet-written session, include it
    // when it would set a PB against the running best (again: never a PB
    // when there's no prior entry for that exercise).
    if (
      candidate &&
      candidate.exerciseKey === exerciseKey &&
      runningBest != null &&
      candidate.avgFqi - runningBest >= pbMargin
    ) {
      pbs += 1;
    }
  }
  return pbs;
}

/**
 * Count consecutive days ending at `now` that have at least one completed
 * session on any exercise. Today counts as day 1 when a session was logged
 * today; an empty today terminates the streak at 0.
 */
export async function countConsecutiveSessionDays(args: {
  now: Date;
}): Promise<number> {
  const { now } = args;
  const all = await getAllFormSessionHistory();
  // Collapse every entry's endedAt into YYYY-MM-DD so multiple sessions on
  // the same day count once.
  const dayKeys = new Set<string>();
  for (const entries of Object.values(all)) {
    for (const entry of entries) {
      const ts = Date.parse(entry.endedAt);
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      dayKeys.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`,
      );
    }
  }
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Walk backward day-by-day until we hit a gap.
  for (let i = 0; i < 400; i += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    if (dayKeys.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export async function clearFormSessionHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FORM_SESSION_HISTORY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
