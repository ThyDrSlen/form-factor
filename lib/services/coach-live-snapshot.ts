/**
 * coach-live-snapshot
 *
 * Serializes in-memory live session state into a compact, prompt-friendly
 * payload that the AI coach can use for in-session guidance. This module is
 * purely in-memory — it never persists anything and expects the caller
 * (typically the session runner) to hand it freeform session data.
 *
 * Design:
 * - `buildLiveSessionSnapshot` returns `null` when there's nothing useful to
 *   report (no exercise id/name, no FQI, no faults), so call sites can safely
 *   spread `...(snapshot ? { liveSession: snapshot } : {})` into a CoachContext.
 * - `recentFaults` is capped at 3, sorted by count descending — this keeps
 *   the prompt clause short and focused on the highest-frequency faults.
 * - `summarizeForPrompt` returns a 1-2 line plaintext summary suitable for
 *   embedding in a system prompt clause.
 */

export interface LiveFQIScores {
  rom?: number;
  symmetry?: number;
  tempo?: number;
  stability?: number;
}

export interface LiveFaultEntry {
  id: string;
  count: number;
  lastRepNumber?: number;
}

export interface LiveSessionSnapshot {
  exerciseId?: string;
  exerciseName?: string;
  currentFQI?: LiveFQIScores;
  recentFaults: LiveFaultEntry[];
}

export interface LiveSessionInput {
  exerciseId?: string;
  exerciseName?: string;
  currentFQI?: LiveFQIScores;
  recentFaults?: LiveFaultEntry[];
}

const MAX_FAULTS = 3;

function hasAnyFQI(fqi?: LiveFQIScores): boolean {
  if (!fqi) return false;
  return (
    typeof fqi.rom === 'number' ||
    typeof fqi.symmetry === 'number' ||
    typeof fqi.tempo === 'number' ||
    typeof fqi.stability === 'number'
  );
}

function sanitizeFaults(faults?: LiveFaultEntry[]): LiveFaultEntry[] {
  if (!faults || faults.length === 0) return [];
  return faults
    .filter((f) => f && typeof f.id === 'string' && f.id.length > 0 && typeof f.count === 'number' && f.count > 0)
    .map((f) => ({
      id: f.id,
      count: Math.max(0, Math.floor(f.count)),
      ...(typeof f.lastRepNumber === 'number' ? { lastRepNumber: f.lastRepNumber } : {}),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_FAULTS);
}

/**
 * Build a snapshot from freeform in-memory input. Returns null when there's
 * no meaningful payload (no exercise, no FQI, no faults).
 */
export function buildLiveSessionSnapshot(input: LiveSessionInput): LiveSessionSnapshot | null {
  if (!input) return null;

  const exerciseId = typeof input.exerciseId === 'string' && input.exerciseId.trim() ? input.exerciseId.trim() : undefined;
  const exerciseName = typeof input.exerciseName === 'string' && input.exerciseName.trim() ? input.exerciseName.trim() : undefined;
  const hasFQI = hasAnyFQI(input.currentFQI);
  const recentFaults = sanitizeFaults(input.recentFaults);

  if (!exerciseId && !exerciseName && !hasFQI && recentFaults.length === 0) {
    return null;
  }

  const snap: LiveSessionSnapshot = { recentFaults };
  if (exerciseId) snap.exerciseId = exerciseId;
  if (exerciseName) snap.exerciseName = exerciseName;
  if (hasFQI && input.currentFQI) {
    const fqi: LiveFQIScores = {};
    if (typeof input.currentFQI.rom === 'number') fqi.rom = input.currentFQI.rom;
    if (typeof input.currentFQI.symmetry === 'number') fqi.symmetry = input.currentFQI.symmetry;
    if (typeof input.currentFQI.tempo === 'number') fqi.tempo = input.currentFQI.tempo;
    if (typeof input.currentFQI.stability === 'number') fqi.stability = input.currentFQI.stability;
    snap.currentFQI = fqi;
  }
  return snap;
}

function formatFQIScore(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

/**
 * Produce a short plaintext description of the snapshot suitable for a
 * system-prompt clause. Keeps output to 1-2 lines. Returns empty string if
 * the snapshot is empty (defensive — callers should gate on null first).
 */
export function summarizeForPrompt(snap: LiveSessionSnapshot | null | undefined): string {
  if (!snap) return '';

  const parts: string[] = [];
  const name = snap.exerciseName || snap.exerciseId;
  if (name) {
    parts.push(`exercise=${name}`);
  }

  if (snap.currentFQI) {
    const fqiParts: string[] = [];
    const rom = formatFQIScore(snap.currentFQI.rom);
    const sym = formatFQIScore(snap.currentFQI.symmetry);
    const tempo = formatFQIScore(snap.currentFQI.tempo);
    const stab = formatFQIScore(snap.currentFQI.stability);
    if (rom !== null) fqiParts.push(`rom=${rom}`);
    if (sym !== null) fqiParts.push(`symmetry=${sym}`);
    if (tempo !== null) fqiParts.push(`tempo=${tempo}`);
    if (stab !== null) fqiParts.push(`stability=${stab}`);
    if (fqiParts.length > 0) {
      parts.push(`FQI(${fqiParts.join(', ')})`);
    }
  }

  if (snap.recentFaults.length > 0) {
    const faultStr = snap.recentFaults
      .map((f) => (typeof f.lastRepNumber === 'number' ? `${f.id}×${f.count}@rep${f.lastRepNumber}` : `${f.id}×${f.count}`))
      .join(', ');
    parts.push(`recent faults: ${faultStr}`);
  }

  return parts.join('; ');
}
