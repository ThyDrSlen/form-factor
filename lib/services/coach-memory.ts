/**
 * Coach Memory (device-local cross-session memory)
 *
 * AsyncStorage-backed cache that holds a compact `SessionBrief` per session
 * plus a rolling `TrainingWeekSummary`. The goal is to make the coach
 * session-aware between prompts: so on the next `sendCoachPrompt()` we can
 * prepend a small "memory clause" describing what the athlete just did.
 *
 * MVP is device-local only. Cross-device / Supabase-backed memory is a
 * deferred follow-up (tracked in issue #458 as a non-goal). See
 * `coach-memory-context.ts` for the phase synthesizer that consumes this.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A compact snapshot of a finished workout session, small enough to prepend
 * to an LLM prompt (a few hundred tokens at most).
 */
export interface SessionBrief {
  sessionId: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  durationMinutes: number | null;
  goalProfile: string | null;
  topExerciseName?: string | null;
  totalSets: number;
  totalReps: number;
  avgRpe: number | null;
  avgFqi: number | null;
  notablePositive?: string | null;
  notableNegative?: string | null;
  /**
   * When the brief was cached. Briefs older than MEMORY_TTL_MS are treated as
   * stale and returned as `null` from `getCachedSessionBrief`.
   */
  cachedAt: string;
}

/**
 * A rolling 7-day summary used by the memory-context synthesizer to infer
 * the user's current training phase (recovery / building / peaking).
 */
export interface TrainingWeekSummary {
  windowStartedAt: string; // ISO timestamp
  sessionCount: number;
  totalSets: number;
  avgRpe: number | null;
  avgFqi: number | null;
  volumeTrend: 'rising' | 'falling' | 'flat';
  /**
   * 'recovery' | 'building' | 'peaking' | 'unknown'
   * Stored alongside the summary so consumers can reuse the heuristic output
   * without re-running the inference.
   */
  phase: 'recovery' | 'building' | 'peaking' | 'unknown';
  cachedAt: string;
}

// ---------------------------------------------------------------------------
// Storage keys & TTL
// ---------------------------------------------------------------------------

/** Namespace chosen to match `coach_` keys already in use by other features. */
export const SESSION_BRIEF_KEY_PREFIX = 'coach_session_brief:';
export const WEEK_SUMMARY_KEY = 'coach_training_week_summary';
export const LAST_SESSION_BRIEF_KEY = 'coach_session_brief:last';

/** 30 days. Briefs older than this are ignored when read. */
export const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cache API
// ---------------------------------------------------------------------------

function isStale(cachedAt: string, now: number): boolean {
  const t = Date.parse(cachedAt);
  if (Number.isNaN(t)) return true;
  return now - t > MEMORY_TTL_MS;
}

/**
 * Write a `SessionBrief` to AsyncStorage keyed by session id, and also
 * update the "last session" pointer so `getCachedSessionBrief()` without args
 * returns the most recent one.
 */
export async function cacheSessionBrief(brief: SessionBrief): Promise<void> {
  try {
    const payload = JSON.stringify(brief);
    await AsyncStorage.setItem(`${SESSION_BRIEF_KEY_PREFIX}${brief.sessionId}`, payload);
    await AsyncStorage.setItem(LAST_SESSION_BRIEF_KEY, payload);
  } catch (err) {
    warnWithTs('[coach-memory] cacheSessionBrief failed', err);
  }
}

/**
 * Read the cached brief for a specific session, or the most-recent one if
 * `sessionId` is omitted. Returns `null` on miss, parse failure, or when the
 * cached record is older than `MEMORY_TTL_MS`.
 */
export async function getCachedSessionBrief(
  sessionId?: string,
): Promise<SessionBrief | null> {
  try {
    const key = sessionId
      ? `${SESSION_BRIEF_KEY_PREFIX}${sessionId}`
      : LAST_SESSION_BRIEF_KEY;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionBrief;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionId) return null;
    if (isStale(parsed.cachedAt, Date.now())) return null;
    return parsed;
  } catch (err) {
    warnWithTs('[coach-memory] getCachedSessionBrief failed', err);
    return null;
  }
}

/**
 * Write the rolling 7-day summary. Overwrites any prior copy — the summary
 * is recomputed periodically by `coach-memory-context`.
 */
export async function cacheWeekSummary(summary: TrainingWeekSummary): Promise<void> {
  try {
    await AsyncStorage.setItem(WEEK_SUMMARY_KEY, JSON.stringify(summary));
  } catch (err) {
    warnWithTs('[coach-memory] cacheWeekSummary failed', err);
  }
}

/** Read the rolling 7-day summary, or `null` when absent / stale / corrupt. */
export async function getCachedWeekSummary(): Promise<TrainingWeekSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(WEEK_SUMMARY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrainingWeekSummary;
    if (!parsed || typeof parsed !== 'object') return null;
    if (isStale(parsed.cachedAt, Date.now())) return null;
    return parsed;
  } catch (err) {
    warnWithTs('[coach-memory] getCachedWeekSummary failed', err);
    return null;
  }
}

/**
 * Clear all memory keys. Used on sign-out and for debug reset. Keys are
 * scanned lazily: we only remove the well-known pointers plus any keys with
 * our brief prefix so we do not blow away unrelated AsyncStorage state.
 */
export async function clearSessionMemory(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const briefKeys = allKeys.filter((k) => k.startsWith(SESSION_BRIEF_KEY_PREFIX));
    const toRemove = [...briefKeys, WEEK_SUMMARY_KEY];
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch (err) {
    warnWithTs('[coach-memory] clearSessionMemory failed', err);
  }
}
