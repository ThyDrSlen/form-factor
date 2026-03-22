/**
 * Time Under Tension (TUT) Estimator
 *
 * Estimates TUT per set based on tempo notation and rep count.
 */

import type { TutSource } from '../types/workout-session';

export interface TutResult {
  tut_ms: number;
  tut_source: TutSource;
}

export interface TempoPhases {
  eccentric: number;
  pauseBottom: number;
  concentric: number;
  pauseTop: number;
}

export function parseTempo(tempo: string | null | undefined): TempoPhases | null {
  if (!tempo) return null;

  const parts = tempo.split('-').map(Number);
  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    return {
      eccentric: parts[0],
      pauseBottom: parts[1],
      concentric: parts[2],
      pauseTop: 0,
    };
  }

  if (parts.length === 4) {
    return {
      eccentric: parts[0],
      pauseBottom: parts[1],
      concentric: parts[2],
      pauseTop: parts[3],
    };
  }

  return null;
}

const DEFAULT_TEMPO: TempoPhases = {
  eccentric: 2,
  pauseBottom: 0,
  concentric: 2,
  pauseTop: 0,
};

export function estimateTut(
  reps: number,
  tempo?: string | null,
): TutResult {
  const phases = parseTempo(tempo) ?? DEFAULT_TEMPO;
  const tutPerRep = phases.eccentric + phases.pauseBottom + phases.concentric + phases.pauseTop;
  const tutMs = Math.round(reps * tutPerRep * 1000);

  return {
    tut_ms: tutMs,
    tut_source: 'estimated',
  };
}

export function timedSetTut(actualSeconds: number): TutResult {
  return {
    tut_ms: Math.round(actualSeconds * 1000),
    tut_source: 'estimated',
  };
}

export function measuredTut(tutMs: number): TutResult {
  return {
    tut_ms: tutMs,
    tut_source: 'measured',
  };
}
