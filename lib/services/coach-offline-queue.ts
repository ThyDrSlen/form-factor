/**
 * Coach offline queue — durable pending-asks store for when the user taps
 * the coach while the app is offline. Wave-31 ships the library-level
 * primitive only; wiring into `coach.tsx` and the offline banner is
 * deferred to the next PR so the surface stays isolated.
 *
 * Storage is a single AsyncStorage entry holding a JSON-stringified array
 * of entries (cap 20, newest-first). A SQLite-backed queue was considered
 * but would require a new migration which is locked in this wave.
 *
 * The drain step is dependency-injected: callers pass a replay callback so
 * the queue doesn't need to know about coach-service shapes (and so tests
 * can assert ordering without spinning up the real dispatcher).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

export type CoachQueueTaskKind =
  | 'chat'
  | 'debrief'
  | 'drill_explainer'
  | 'session_generator'
  | 'progression_planner'
  | 'other';

export interface CoachQueueEntry {
  /** Stable identifier so callers can dedupe optimistic UI updates. */
  id: string;
  /** User prompt text. */
  prompt: string;
  /** Categorisation used by the dispatcher when we eventually replay. */
  taskKind: CoachQueueTaskKind;
  /** Queue insertion time (ms since epoch). */
  timestamp: number;
  /** Optional free-form context captured at enqueue time (e.g. session id). */
  context?: string;
}

export type CoachQueueReplayResult = 'ok' | 'retry' | 'drop';

export type CoachQueueReplay = (
  entry: CoachQueueEntry,
) => Promise<CoachQueueReplayResult>;

export interface DrainReport {
  attempted: number;
  ok: number;
  retry: number;
  dropped: number;
}

// =============================================================================
// Storage
// =============================================================================

export const COACH_QUEUE_STORAGE_KEY = '@coach_offline_queue/v1';

/**
 * Maximum entries we keep. Newer entries evict the oldest so the queue
 * can't grow without bound when the user is offline for days.
 */
export const COACH_QUEUE_MAX_ENTRIES = 20;

function isValidEntry(value: unknown): value is CoachQueueEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<CoachQueueEntry>;
  return (
    typeof v.id === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.taskKind === 'string' &&
    typeof v.timestamp === 'number' &&
    (v.context === undefined || typeof v.context === 'string')
  );
}

async function readQueue(): Promise<CoachQueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(COACH_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch (error) {
    warnWithTs('[coach-offline-queue] readQueue failed', error);
    return [];
  }
}

async function writeQueue(entries: CoachQueueEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      COACH_QUEUE_STORAGE_KEY,
      JSON.stringify(entries),
    );
  } catch (error) {
    warnWithTs('[coach-offline-queue] writeQueue failed', error);
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface EnqueueInput {
  prompt: string;
  taskKind: CoachQueueTaskKind;
  context?: string;
  /** Override for tests / deterministic IDs. */
  id?: string;
  /** Override for tests. */
  timestamp?: number;
}

/**
 * Append an entry to the queue (newest at the tail). When the queue
 * exceeds `COACH_QUEUE_MAX_ENTRIES`, the oldest entries are dropped.
 * Returns the entry that was stored (callers can use the assigned id for
 * optimistic UI).
 */
export async function enqueue(input: EnqueueInput): Promise<CoachQueueEntry> {
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new Error('coach-offline-queue: prompt is required');
  }

  const existing = await readQueue();
  const entry: CoachQueueEntry = {
    id: input.id ?? randomId(),
    prompt: input.prompt,
    taskKind: input.taskKind,
    timestamp: input.timestamp ?? Date.now(),
    ...(input.context ? { context: input.context } : {}),
  };

  const next = [...existing, entry];
  while (next.length > COACH_QUEUE_MAX_ENTRIES) {
    next.shift();
  }
  await writeQueue(next);
  return entry;
}

/** Return the current queue snapshot (oldest first). */
export async function pending(): Promise<CoachQueueEntry[]> {
  return readQueue();
}

/**
 * Drain the queue by calling `replay` for each pending entry in insertion
 * order (oldest first — users expect their earliest ask to be answered
 * first when reconnecting). Entries are removed on `ok`/`drop` and kept
 * on `retry`. A thrown error from `replay` is treated as `retry` so a
 * single transient failure doesn't lose user prompts.
 *
 * Returns a summary so the banner UI can render "3 of 5 sent, 2
 * waiting" without touching the store directly.
 */
export async function drain(replay: CoachQueueReplay): Promise<DrainReport> {
  const entries = await readQueue();
  const remaining: CoachQueueEntry[] = [];
  let ok = 0;
  let retry = 0;
  let dropped = 0;

  for (const entry of entries) {
    let outcome: CoachQueueReplayResult;
    try {
      outcome = await replay(entry);
    } catch (error) {
      warnWithTs('[coach-offline-queue] replay threw; keeping entry', error);
      outcome = 'retry';
    }
    if (outcome === 'ok') {
      ok += 1;
      continue;
    }
    if (outcome === 'drop') {
      dropped += 1;
      continue;
    }
    retry += 1;
    remaining.push(entry);
  }

  await writeQueue(remaining);
  return { attempted: entries.length, ok, retry, dropped };
}

/** Wipe the queue — used for sign-out and tests. */
export async function clear(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_QUEUE_STORAGE_KEY);
  } catch (error) {
    warnWithTs('[coach-offline-queue] clear failed', error);
  }
}

// =============================================================================
// Internals
// =============================================================================

function randomId(): string {
  // Cheap opaque id — we don't need cryptographic uniqueness for an
  // in-app queue key, just enough entropy to avoid collisions inside a
  // 20-item buffer.
  return `coach-q-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
