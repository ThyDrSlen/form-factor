/**
 * Rep Pain Journal
 *
 * AsyncStorage-backed on-device journal for rep-level injury/pain flags.
 * This is intentionally NOT persisted to Supabase tonight — adding a
 * `pain_flags` table requires a migration, which is banned under the
 * overnight rules (see CLAUDE.md). A `syncToSupabase()` stub is provided
 * so callers can wire the UI today; the stub is a typed no-op and will
 * be replaced with a real sync call once a migration lands (see
 * TODO(day) below).
 *
 * Storage shape: one key per user (`pain-journal:v1:<userId>`) containing
 * a JSON array of `PainFlag` records. Keeping everything in a single key
 * keeps read/write cheap (one round-trip) and is fine for the expected
 * volume (< 1k flags per user).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { errorWithTs, logWithTs } from '@/lib/logger';

// =============================================================================
// Public types
// =============================================================================

export type PainLocation =
  | 'lower_back'
  | 'upper_back'
  | 'knee'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'hip'
  | 'other';

/** Severity on a 1-5 scale. 1 = twinge, 5 = stop-the-set. */
export type PainSeverity = 1 | 2 | 3 | 4 | 5;

export interface PainFlag {
  /** Client-side UUID (pass in or we'll mint one). */
  id: string;
  /** Stable rep identifier — recommend `${sessionSetId}:${repNumber}`. */
  repId: string;
  /** Session the rep belongs to. */
  sessionId: string;
  /** Pain location. `other` allows free-form via `notes`. */
  location: PainLocation;
  /** 1-5 severity. */
  severity: PainSeverity;
  /** Optional free-form notes (<= 500 chars). */
  notes?: string;
  /** ISO timestamp when the flag was created (user's clock). */
  createdAt: string;
  /**
   * Whether this flag has been pushed to Supabase. Always `false` at the
   * moment since `syncToSupabase()` is a no-op; field exists so the UI
   * can show sync state once the migration lands.
   */
  synced: boolean;
}

export interface FlagRepPainInput {
  repId: string;
  sessionId: string;
  location: PainLocation;
  severity: PainSeverity;
  notes?: string;
  /** Optional pre-minted id (tests pass this in). */
  id?: string;
}

// =============================================================================
// Key construction
// =============================================================================

const KEY_PREFIX = 'pain-journal:v1:';

/** Build the storage key for a given user. Exposed for testing. */
export function painJournalKey(userId: string): string {
  if (!userId || typeof userId !== 'string') {
    throw new Error('[pain-journal] userId is required');
  }
  return `${KEY_PREFIX}${userId}`;
}

// =============================================================================
// Internal I/O helpers
// =============================================================================

async function readAll(userId: string): Promise<PainFlag[]> {
  const raw = await AsyncStorage.getItem(painJournalKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop any malformed entries so a corrupt item can't break
    // the whole timeline render.
    return parsed.filter(isPainFlag);
  } catch (err) {
    errorWithTs('[pain-journal] Failed to parse stored flags', err);
    return [];
  }
}

async function writeAll(userId: string, flags: PainFlag[]): Promise<void> {
  await AsyncStorage.setItem(painJournalKey(userId), JSON.stringify(flags));
}

function isPainFlag(value: unknown): value is PainFlag {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.repId === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.location === 'string' &&
    typeof v.severity === 'number' &&
    typeof v.createdAt === 'string'
  );
}

function mintId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `pf_${Date.now().toString(36)}_${rand}`;
}

function clampSeverity(n: number): PainSeverity {
  const rounded = Math.round(n);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded as PainSeverity;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Log a pain flag against a specific rep. Returns the persisted flag so
 * callers can immediately render it or feed it into weight-adjustment
 * heuristics (see `adjustNextSetWeight`).
 */
export async function flagRepPain(
  userId: string,
  input: FlagRepPainInput,
): Promise<PainFlag> {
  const flags = await readAll(userId);
  const flag: PainFlag = {
    id: input.id ?? mintId(),
    repId: input.repId,
    sessionId: input.sessionId,
    location: input.location,
    severity: clampSeverity(input.severity),
    notes: input.notes?.slice(0, 500),
    createdAt: new Date().toISOString(),
    synced: false,
  };
  flags.push(flag);
  await writeAll(userId, flags);
  logWithTs('[pain-journal] flag recorded', {
    repId: flag.repId,
    severity: flag.severity,
  });
  return flag;
}

/**
 * Read pain flags for a user, optionally constrained to the last `days`
 * days. Results are sorted newest-first.
 *
 * `days` defaults to 30; pass `Infinity` to read everything.
 */
export async function getPainFlags(
  userId: string,
  days: number = 30,
): Promise<PainFlag[]> {
  const flags = await readAll(userId);
  const cutoff = Number.isFinite(days)
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : -Infinity;
  return flags
    .filter((f) => {
      const t = Date.parse(f.createdAt);
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Remove a single flag by id. No-op if not present. */
export async function deletePainFlag(
  userId: string,
  flagId: string,
): Promise<void> {
  const flags = await readAll(userId);
  const next = flags.filter((f) => f.id !== flagId);
  if (next.length === flags.length) return;
  await writeAll(userId, next);
}

/** Wipe the entire journal for a user (used by sign-out / tests). */
export async function clearPainJournal(userId: string): Promise<void> {
  await AsyncStorage.removeItem(painJournalKey(userId));
}

/**
 * Compute a fractional weight reduction for the next set based on the
 * severity of a pain flag. `severity * 2%` per the issue spec, capped
 * at 15% so a severity 5 flag doesn't zero out the next set.
 */
export function computeWeightReductionFraction(severity: PainSeverity): number {
  const raw = severity * 0.02;
  return Math.min(raw, 0.15);
}

/**
 * Apply a weight-adjustment recommendation for the next set. The real
 * session runner does not currently expose a typed "pending weight"
 * API, so we emit a debug log and return the recommended delta for the
 * caller. When #461 or a session-runner refactor lands, this function
 * can be updated to call into the store directly.
 *
 * TODO(session-runner): wire into `useSessionRunner.updateSet` once the
 * store exposes a "next pending set" accessor.
 */
export function adjustNextSetWeight(
  sessionId: string,
  severity: PainSeverity,
): { sessionId: string; severity: PainSeverity; recommendedDeltaFraction: number } {
  const fraction = computeWeightReductionFraction(severity);
  logWithTs('[pain-journal] recommending next-set reduction', {
    sessionId,
    severity,
    reductionFraction: fraction,
  });
  return {
    sessionId,
    severity,
    recommendedDeltaFraction: -fraction,
  };
}

/**
 * Push pending pain flags to Supabase.
 *
 * NO-OP STUB — a real `pain_flags` table requires a Supabase migration,
 * which is banned under the overnight rules (CLAUDE.md). Once the
 * migration ships, this function should:
 *   1. Read any flags where `synced=false`.
 *   2. Upsert to `public.pain_flags` keyed on `id`.
 *   3. Update local copies with `synced=true`.
 *
 * TODO(day): replace with real Supabase upsert once `pain_flags` migration
 * is merged (see related issue filed with this PR).
 */
export async function syncToSupabase(_userId: string): Promise<{
  attempted: number;
  synced: number;
  skipped: 'migration_pending';
}> {
  return Promise.resolve({
    attempted: 0,
    synced: 0,
    skipped: 'migration_pending' as const,
  });
}

/**
 * Human-readable labels for pain locations, keyed by PainLocation.
 * Exposed so modals/pickers don't have to hardcode copy.
 */
export const PAIN_LOCATION_LABELS: Record<PainLocation, string> = {
  lower_back: 'Lower back',
  upper_back: 'Upper back',
  knee: 'Knee',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  hip: 'Hip',
  other: 'Other',
};
