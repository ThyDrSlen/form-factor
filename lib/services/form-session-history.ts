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

export async function clearFormSessionHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FORM_SESSION_HISTORY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
