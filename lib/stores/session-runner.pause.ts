/**
 * Session Runner Pause Extension
 *
 * Standalone module that layers pause/resume semantics onto the core
 * useSessionRunner store without modifying the main file. Kept
 * separate so the PR #424 review boundary is preserved.
 *
 * Strategy: persist the "paused-at" timestamp into workout_session_events
 * so the existing sync pipeline carries it, and track an in-memory
 * isPaused flag that ScanARKit / autopause can observe via
 * useSessionPauseState().
 */
import { useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { localDB } from '@/lib/services/database/local-db';
import { genericLocalUpsert } from '@/lib/services/database/generic-sync';
import { useSessionRunner } from '@/lib/stores/session-runner';
import type { SessionEventType } from '@/lib/types/workout-session';

interface PauseState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: PauseReason | null;
}

export type PauseReason = 'background' | 'manual' | 'phone-call' | 'auto';

const initialState: PauseState = {
  isPaused: false,
  pausedAt: null,
  reason: null,
};

let state: PauseState = { ...initialState };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PauseState {
  return state;
}

export function useSessionPauseState(): PauseState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Mark the active session as paused and persist a resume event breadcrumb.
 * No-op when no active session exists.
 */
export async function pauseActiveSession(reason: PauseReason = 'manual'): Promise<void> {
  const session = useSessionRunner.getState().activeSession;
  if (!session) return;
  if (state.isPaused) return; // already paused
  const now = new Date().toISOString();
  state = { isPaused: true, pausedAt: now, reason };
  emit();

  await writeEvent(session.id, 'rest_started', {
    subtype: 'session_paused',
    reason,
    paused_at: now,
  });
}

/**
 * Resume a paused session. Calculates the paused-duration for telemetry
 * and clears the in-memory pause state.
 */
export async function resumeActiveSession(): Promise<number> {
  const session = useSessionRunner.getState().activeSession;
  if (!session) return 0;
  if (!state.isPaused) return 0;

  const pausedAt = state.pausedAt;
  const resumedAt = new Date().toISOString();
  const durationMs = pausedAt ? new Date(resumedAt).getTime() - new Date(pausedAt).getTime() : 0;
  state = { ...initialState };
  emit();

  await writeEvent(session.id, 'rest_completed', {
    subtype: 'session_resumed',
    paused_at: pausedAt,
    resumed_at: resumedAt,
    paused_duration_ms: durationMs,
  });
  return Math.max(0, durationMs);
}

/**
 * Convenience toggle: pauses if running, resumes if paused.
 * Returns the new isPaused state.
 */
export async function toggleActiveSessionPause(
  reason: PauseReason = 'manual',
): Promise<boolean> {
  if (state.isPaused) {
    await resumeActiveSession();
    return false;
  }
  await pauseActiveSession(reason);
  return true;
}

/** Reset both in-memory and external listeners (tests only). */
export function __resetSessionPauseState(): void {
  state = { ...initialState };
  for (const l of listeners) l();
}

async function writeEvent(
  sessionId: string,
  type: SessionEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const db = localDB.db;
    if (!db) {
      // still record via generic upsert so the sync queue carries it
      // when a native DB is available — on web this is effectively a no-op.
      return;
    }
    const row: Record<string, unknown> = {
      id: Crypto.randomUUID(),
      session_id: sessionId,
      created_at: new Date().toISOString(),
      type,
      session_exercise_id: null,
      session_set_id: null,
      payload: JSON.stringify(payload),
      synced: 0,
    };
    await genericLocalUpsert('workout_session_events', 'id', row, 0);
  } catch {
    // best-effort; never throw in the pause path
  }
}
