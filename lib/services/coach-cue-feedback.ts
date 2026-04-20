/**
 * Coach Cue Feedback
 *
 * Persists per-exercise, per-cue thumbs-up / thumbs-down feedback so the
 * coach can down-weight cues the user dislikes and up-weight the ones they
 * find helpful. Feedback decays with age (30-day half-life) so an early
 * bias doesn't calcify and the coach can recover when preferences shift.
 *
 * Local-only (AsyncStorage). Supabase sync is a daytime follow-up.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'coach_cue_feedback_v1';

export const DECAY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const STALE_CUTOFF_MS = 60 * 24 * 60 * 60 * 1000;
export const MAX_RECORDS = 500;

export type CueVote = 'up' | 'down';

export type CueFeedbackRecord = {
  exerciseId: string;
  cueKey: string;
  vote: CueVote;
  createdAt: number;
  sessionId?: string;
  note?: string;
};

type PersistedIndex = {
  version: 1;
  records: CueFeedbackRecord[];
};

function normalizeKey(input: string): string {
  return input.trim().toLowerCase();
}

function isRecord(value: unknown): value is CueFeedbackRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<CueFeedbackRecord>;
  return (
    typeof r.exerciseId === 'string' &&
    typeof r.cueKey === 'string' &&
    (r.vote === 'up' || r.vote === 'down') &&
    typeof r.createdAt === 'number' &&
    Number.isFinite(r.createdAt)
  );
}

async function readIndex(): Promise<PersistedIndex> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, records: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { version: 1, records: [] };
    const records = Array.isArray((parsed as PersistedIndex).records)
      ? ((parsed as PersistedIndex).records as unknown[]).filter(isRecord)
      : [];
    return { version: 1, records };
  } catch {
    return { version: 1, records: [] };
  }
}

async function writeIndex(index: PersistedIndex): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

export type RecordFeedbackInput = {
  exerciseId: string;
  cueKey: string;
  vote: CueVote;
  sessionId?: string;
  note?: string;
  now?: number;
};

export async function recordFeedback(input: RecordFeedbackInput): Promise<CueFeedbackRecord> {
  if (!input.exerciseId) throw new Error('exerciseId required');
  if (!input.cueKey) throw new Error('cueKey required');
  if (input.vote !== 'up' && input.vote !== 'down') throw new Error('vote must be up or down');

  const record: CueFeedbackRecord = {
    exerciseId: normalizeKey(input.exerciseId),
    cueKey: normalizeKey(input.cueKey),
    vote: input.vote,
    createdAt: input.now ?? Date.now(),
    sessionId: input.sessionId,
    note: input.note?.slice(0, 280),
  };

  const index = await readIndex();
  index.records.push(record);
  if (index.records.length > MAX_RECORDS) {
    index.records.splice(0, index.records.length - MAX_RECORDS);
  }
  await writeIndex(index);
  return record;
}

export async function loadFeedback(): Promise<CueFeedbackRecord[]> {
  const { records } = await readIndex();
  return [...records];
}

function weightForAge(ageMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= DECAY_WINDOW_MS) return 0;
  return 1 - ageMs / DECAY_WINDOW_MS;
}

export type CuePreference = {
  cueKey: string;
  score: number;
  voteCount: number;
  lastVoteAt: number;
};

function scoreFor(records: CueFeedbackRecord[], now: number): number {
  if (records.length === 0) return 0;
  let numerator = 0;
  let denominator = 0;
  for (const r of records) {
    const w = weightForAge(now - r.createdAt);
    if (w <= 0) continue;
    numerator += (r.vote === 'up' ? 1 : -1) * w;
    denominator += w;
  }
  if (denominator === 0) return 0;
  const raw = numerator / denominator;
  return Math.max(-1, Math.min(1, raw));
}

export async function getCuePreference(
  exerciseId: string,
  cueKey: string,
  now: number = Date.now(),
): Promise<CuePreference> {
  const ex = normalizeKey(exerciseId);
  const key = normalizeKey(cueKey);
  const { records } = await readIndex();
  const matches = records.filter((r) => r.exerciseId === ex && r.cueKey === key);
  const relevant = matches.filter((r) => now - r.createdAt < DECAY_WINDOW_MS);
  const lastVoteAt = relevant.reduce((acc, r) => Math.max(acc, r.createdAt), 0);
  return {
    cueKey: key,
    score: scoreFor(relevant, now),
    voteCount: relevant.length,
    lastVoteAt,
  };
}

export async function getExercisePreferences(
  exerciseId: string,
  now: number = Date.now(),
): Promise<CuePreference[]> {
  const ex = normalizeKey(exerciseId);
  const { records } = await readIndex();
  const byKey = new Map<string, CueFeedbackRecord[]>();
  for (const r of records) {
    if (r.exerciseId !== ex) continue;
    if (now - r.createdAt >= DECAY_WINDOW_MS) continue;
    const bucket = byKey.get(r.cueKey) ?? [];
    bucket.push(r);
    byKey.set(r.cueKey, bucket);
  }
  return [...byKey.entries()].map(([cueKey, bucket]) => ({
    cueKey,
    score: scoreFor(bucket, now),
    voteCount: bucket.length,
    lastVoteAt: bucket.reduce((acc, r) => Math.max(acc, r.createdAt), 0),
  }));
}

/**
 * Remove records older than STALE_CUTOFF_MS. Returns the count removed.
 * Call occasionally (e.g., on app start) to keep the index bounded.
 */
export async function pruneStale(now: number = Date.now()): Promise<number> {
  const { records } = await readIndex();
  const kept = records.filter((r) => now - r.createdAt < STALE_CUTOFF_MS);
  const removed = records.length - kept.length;
  if (removed > 0) await writeIndex({ version: 1, records: kept });
  return removed;
}

export async function clearAll(): Promise<void> {
  await writeIndex({ version: 1, records: [] });
}

export async function __resetForTests(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
