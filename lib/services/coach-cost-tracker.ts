/**
 * Coach cost tracker — an in-memory + AsyncStorage accumulator for coach
 * token usage. Pure data service; no UI. Callers (cloud provider dispatcher,
 * on-device runner, offline queue) record usage events; consumers read a
 * weekly aggregate to surface "you've used X tokens this week" or block
 * further requests past a budget.
 *
 * Persistence is best-effort — if AsyncStorage is unavailable or throws, we
 * keep the in-memory counter and log a warning. The tracker never crashes
 * the coach path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { warnWithTs } from '@/lib/logger';
import { createError, type AppError } from './ErrorHandler';

// =============================================================================
// Types
// =============================================================================

export type CoachProvider = 'openai' | 'gemma_cloud' | 'gemma_ondevice' | 'stub';

export type CoachTaskKind =
  | 'chat'
  | 'debrief'
  | 'auto_debrief'
  | 'drill_explainer'
  | 'session_generator'
  | 'warmup_generator'
  | 'progression_planner'
  | 'form_check'
  | 'voice_debrief'
  | 'voice_nlu'
  | 'rest_period_coaching'
  | 'exercise_swap_explanation'
  | 'multi_turn_debrief'
  | 'program_design'
  | 'fault_explainer'
  | 'other';

export interface CoachUsageEvent {
  /** ISO timestamp. Defaults to `new Date().toISOString()` when omitted. */
  at?: string;
  provider: CoachProvider;
  taskKind: CoachTaskKind;
  tokensIn: number;
  tokensOut: number;
  /** Whether this request hit the response cache (no LLM call). */
  cacheHit?: boolean;
}

interface StoredBucket {
  date: string; // YYYY-MM-DD
  provider: CoachProvider;
  taskKind: CoachTaskKind;
  tokensIn: number;
  tokensOut: number;
  cacheHits: number;
  calls: number;
}

export interface WeeklyAggregate {
  rangeStart: string; // inclusive ISO date
  rangeEnd: string; // exclusive ISO date
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  cacheHitRate: number; // 0–1
  byProvider: Record<
    CoachProvider,
    { tokensIn: number; tokensOut: number; calls: number }
  >;
  byTaskKind: Record<
    CoachTaskKind,
    { tokensIn: number; tokensOut: number; calls: number }
  >;
}

// =============================================================================
// Storage layout
// =============================================================================

const STORAGE_KEY = '@form-factor/coach-cost-tracker/v1';
const MAX_RETENTION_DAYS = 35; // keep ~5 weeks of history

// =============================================================================
// In-memory state
// =============================================================================

const state: {
  buckets: StoredBucket[];
  hydrated: boolean;
} = {
  buckets: [],
  hydrated: false,
};

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function keyOf(date: string, provider: CoachProvider, taskKind: CoachTaskKind): string {
  return `${date}|${provider}|${taskKind}`;
}

function findBucket(
  buckets: StoredBucket[],
  date: string,
  provider: CoachProvider,
  taskKind: CoachTaskKind,
): StoredBucket | null {
  for (const b of buckets) {
    if (b.date === date && b.provider === provider && b.taskKind === taskKind) return b;
  }
  return null;
}

function pruneOld(buckets: StoredBucket[], today: string, maxDays: number): StoredBucket[] {
  const cutoff = addDaysIso(today, -maxDays);
  return buckets.filter((b) => b.date >= cutoff);
}

function addDaysIso(dateKey10: string, delta: number): string {
  const [y, m, d] = dateKey10.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// =============================================================================
// Hydration + persistence
// =============================================================================

async function hydrate(): Promise<void> {
  if (state.hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { buckets?: StoredBucket[] };
      if (parsed && Array.isArray(parsed.buckets)) {
        state.buckets = parsed.buckets.filter(isValidBucket);
      }
    }
  } catch (error) {
    warnWithTs('[coach-cost-tracker] failed to hydrate from AsyncStorage', error);
  } finally {
    state.hydrated = true;
  }
}

function isValidBucket(b: unknown): b is StoredBucket {
  if (typeof b !== 'object' || b === null) return false;
  const record = b as Partial<StoredBucket>;
  return (
    typeof record.date === 'string' &&
    typeof record.provider === 'string' &&
    typeof record.taskKind === 'string' &&
    Number.isFinite(record.tokensIn) &&
    Number.isFinite(record.tokensOut) &&
    Number.isFinite(record.cacheHits) &&
    Number.isFinite(record.calls)
  );
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ buckets: state.buckets }));
  } catch (error) {
    warnWithTs('[coach-cost-tracker] failed to persist to AsyncStorage', error);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Record a coach usage event. Safe to call without awaiting — persistence
 * happens in the background; in-memory state is updated synchronously so
 * subsequent reads return the latest number.
 */
export async function recordCoachUsage(event: CoachUsageEvent): Promise<void> {
  await hydrate();

  const at = event.at ?? new Date().toISOString();
  const date = dateKey(at);
  const tokensIn = Math.max(0, Math.round(event.tokensIn));
  const tokensOut = Math.max(0, Math.round(event.tokensOut));
  const cacheHit = event.cacheHit ? 1 : 0;

  const existing = findBucket(state.buckets, date, event.provider, event.taskKind);
  if (existing) {
    existing.tokensIn += tokensIn;
    existing.tokensOut += tokensOut;
    existing.cacheHits += cacheHit;
    existing.calls += 1;
  } else {
    state.buckets.push({
      date,
      provider: event.provider,
      taskKind: event.taskKind,
      tokensIn,
      tokensOut,
      cacheHits: cacheHit,
      calls: 1,
    });
  }

  state.buckets = pruneOld(state.buckets, date, MAX_RETENTION_DAYS);
  await persist();
}

/**
 * Aggregate usage for the most recent 7 days ending at the given date
 * (defaults to today). `rangeStart`/`rangeEnd` are inclusive/exclusive dates.
 */
export async function getWeeklyAggregate(
  nowIso: string = new Date().toISOString(),
): Promise<WeeklyAggregate> {
  await hydrate();

  const today = dateKey(nowIso);
  const rangeStart = addDaysIso(today, -6);
  const rangeEnd = addDaysIso(today, 1);

  const inWindow = state.buckets.filter((b) => b.date >= rangeStart && b.date < rangeEnd);

  const byProvider = emptyProviderMap();
  const byTaskKind = emptyTaskKindMap();
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCalls = 0;
  let totalCacheHits = 0;

  for (const b of inWindow) {
    totalTokensIn += b.tokensIn;
    totalTokensOut += b.tokensOut;
    totalCalls += b.calls;
    totalCacheHits += b.cacheHits;

    byProvider[b.provider].tokensIn += b.tokensIn;
    byProvider[b.provider].tokensOut += b.tokensOut;
    byProvider[b.provider].calls += b.calls;

    byTaskKind[b.taskKind].tokensIn += b.tokensIn;
    byTaskKind[b.taskKind].tokensOut += b.tokensOut;
    byTaskKind[b.taskKind].calls += b.calls;
  }

  return {
    rangeStart,
    rangeEnd,
    totalTokensIn,
    totalTokensOut,
    totalCalls,
    cacheHitRate: totalCalls === 0 ? 0 : totalCacheHits / totalCalls,
    byProvider,
    byTaskKind,
  };
}

// =============================================================================
// Per-surface daily budgets (#592 wave-35)
// =============================================================================
//
// Each generator / auto-debrief / drill-explainer surface gets its own daily
// budget cap so a runaway loop on one feature can't drain the whole weekly
// allowance. Defaults are conservative — they reflect realistic usage patterns
// observed in wave-27/28 telemetry (debriefs run once per session, generators
// once or twice per day, drill explainers fire 3-5× per session). Kept
// hardcoded since product hasn't asked for user-facing configurability yet.
// Pipeline v2 can override by mutating `__setDailyBudgetForTests` in tests.

const DEFAULT_DAILY_BUDGETS: Readonly<Partial<Record<CoachTaskKind, number>>> = Object.freeze({
  session_generator: 50_000,
  warmup_generator: 10_000,
  auto_debrief: 20_000,
  debrief: 20_000, // alias matching existing surface label
  drill_explainer: 15_000,
});

const dailyBudgetOverrides = new Map<CoachTaskKind, number>();

function resolveDailyBudget(taskKind: CoachTaskKind): number | undefined {
  if (dailyBudgetOverrides.has(taskKind)) {
    return dailyBudgetOverrides.get(taskKind);
  }
  return DEFAULT_DAILY_BUDGETS[taskKind];
}

/**
 * Get remaining token headroom for a given surface on `nowIso`'s date.
 *
 * Sums tokensIn + tokensOut across all providers for the surface on that day.
 * Returns `Infinity` when no budget is configured (unbounded surface).
 */
export async function getAvailableBudget(
  taskKind: CoachTaskKind,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  await hydrate();
  const budget = resolveDailyBudget(taskKind);
  if (budget === undefined) return Number.POSITIVE_INFINITY;

  const date = dateKey(nowIso);
  let used = 0;
  for (const b of state.buckets) {
    if (b.date === date && b.taskKind === taskKind) {
      used += b.tokensIn + b.tokensOut;
    }
  }
  return Math.max(0, budget - used);
}

/**
 * Shape of the typed budget-exceeded error. Callers can `instanceof`-check
 * via the exported helper or switch on `domain`/`code` via the AppError
 * envelope.
 */
export interface BudgetExceededError extends AppError {
  code: 'COACH_BUDGET_EXCEEDED';
  taskKind: CoachTaskKind;
  usedTokens: number;
  dailyBudget: number;
}

export function isBudgetExceededError(err: unknown): err is BudgetExceededError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'COACH_BUDGET_EXCEEDED'
  );
}

export function createBudgetExceededError(
  taskKind: CoachTaskKind,
  usedTokens: number,
  dailyBudget: number,
): BudgetExceededError {
  const base = createError(
    'coach',
    'COACH_BUDGET_EXCEEDED',
    `Daily coach budget exceeded for ${taskKind} (used ${usedTokens} / ${dailyBudget} tokens).`,
    { retryable: false, severity: 'warning' },
  );
  return { ...base, code: 'COACH_BUDGET_EXCEEDED', taskKind, usedTokens, dailyBudget };
}

/**
 * Throw a typed BudgetExceededError when the daily budget for `taskKind` is
 * already exhausted. No-op when the surface has no configured budget, or
 * when there is remaining headroom. Intended as a pre-dispatch guard —
 * callers invoke this before hitting the Gemma/OpenAI edge functions so
 * the UI can show a quota-exceeded state without paying for the call.
 */
export async function assertDailyBudget(
  taskKind: CoachTaskKind,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const budget = resolveDailyBudget(taskKind);
  if (budget === undefined) return;

  const remaining = await getAvailableBudget(taskKind, nowIso);
  if (remaining > 0) return;

  const used = budget - remaining; // remaining is capped at 0 so used >= budget
  throw createBudgetExceededError(taskKind, used, budget);
}

/** Tests-only: override the daily budget for a given surface. */
export function __setDailyBudgetForTests(
  taskKind: CoachTaskKind,
  tokens: number | undefined,
): void {
  if (tokens === undefined) {
    dailyBudgetOverrides.delete(taskKind);
  } else {
    dailyBudgetOverrides.set(taskKind, tokens);
  }
}

/** Tests-only: clear every override. */
export function __clearDailyBudgetOverridesForTests(): void {
  dailyBudgetOverrides.clear();
}

/** Reset the tracker. Intended for tests and sign-out. */
export async function resetCoachCostTracker(): Promise<void> {
  state.buckets = [];
  state.hydrated = true;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    warnWithTs('[coach-cost-tracker] failed to clear AsyncStorage', error);
  }
}

/** Internal: forces re-hydration on next call. Tests only. */
export function __invalidateHydrationForTests(): void {
  state.hydrated = false;
  state.buckets = [];
}

function emptyProviderMap(): WeeklyAggregate['byProvider'] {
  return {
    openai: { tokensIn: 0, tokensOut: 0, calls: 0 },
    gemma_cloud: { tokensIn: 0, tokensOut: 0, calls: 0 },
    gemma_ondevice: { tokensIn: 0, tokensOut: 0, calls: 0 },
    stub: { tokensIn: 0, tokensOut: 0, calls: 0 },
  };
}

function emptyTaskKindMap(): WeeklyAggregate['byTaskKind'] {
  return {
    chat: { tokensIn: 0, tokensOut: 0, calls: 0 },
    debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
    auto_debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
    drill_explainer: { tokensIn: 0, tokensOut: 0, calls: 0 },
    session_generator: { tokensIn: 0, tokensOut: 0, calls: 0 },
    warmup_generator: { tokensIn: 0, tokensOut: 0, calls: 0 },
    progression_planner: { tokensIn: 0, tokensOut: 0, calls: 0 },
    form_check: { tokensIn: 0, tokensOut: 0, calls: 0 },
    voice_debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
    voice_nlu: { tokensIn: 0, tokensOut: 0, calls: 0 },
    rest_period_coaching: { tokensIn: 0, tokensOut: 0, calls: 0 },
    exercise_swap_explanation: { tokensIn: 0, tokensOut: 0, calls: 0 },
    multi_turn_debrief: { tokensIn: 0, tokensOut: 0, calls: 0 },
    program_design: { tokensIn: 0, tokensOut: 0, calls: 0 },
    fault_explainer: { tokensIn: 0, tokensOut: 0, calls: 0 },
    other: { tokensIn: 0, tokensOut: 0, calls: 0 },
  };
}

export const __internal = { STORAGE_KEY, MAX_RETENTION_DAYS };

/** Accessor used to keep `keyOf` reachable for internal re-use and tests. */
export function __keyOfForTests(
  date: string,
  provider: CoachProvider,
  taskKind: CoachTaskKind,
): string {
  return keyOf(date, provider, taskKind);
}
