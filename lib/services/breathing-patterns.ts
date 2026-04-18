/**
 * Breathing Patterns Library
 *
 * Pure data + picker for structured breathing drills used during rest
 * between sets. Each pattern defines phase durations (in seconds) plus a
 * short cue string for each phase, so a timed visualization can drive a
 * simple inhale/hold/exhale/hold animation.
 */

import type { SetType } from '@/lib/types/workout-session';

export type BreathingPhaseType = 'inhale' | 'hold-in' | 'exhale' | 'hold-out';

export interface BreathingPhase {
  type: BreathingPhaseType;
  seconds: number;
  cue: string;
}

export type BreathingContext = 'calming' | 'focus' | 'energizing' | 'recovery' | 'ready';

export type BreathingPatternId = 'box' | 'four-seven-eight' | 'coherent' | 'bellows' | 'diaphragmatic';

export interface BreathingPattern {
  id: BreathingPatternId;
  name: string;
  description: string;
  phases: BreathingPhase[];
  cycleSeconds: number;
  recommendedFor: readonly BreathingContext[];
}

function sumPhases(phases: BreathingPhase[]): number {
  return phases.reduce((acc, p) => acc + p.seconds, 0);
}

const BOX_PHASES: BreathingPhase[] = [
  { type: 'inhale', seconds: 4, cue: 'Breathe in' },
  { type: 'hold-in', seconds: 4, cue: 'Hold' },
  { type: 'exhale', seconds: 4, cue: 'Breathe out' },
  { type: 'hold-out', seconds: 4, cue: 'Hold' },
];

const FOUR_SEVEN_EIGHT_PHASES: BreathingPhase[] = [
  { type: 'inhale', seconds: 4, cue: 'In through nose' },
  { type: 'hold-in', seconds: 7, cue: 'Hold' },
  { type: 'exhale', seconds: 8, cue: 'Out through mouth' },
];

const COHERENT_PHASES: BreathingPhase[] = [
  { type: 'inhale', seconds: 5, cue: 'Breathe in' },
  { type: 'exhale', seconds: 5, cue: 'Breathe out' },
];

const BELLOWS_PHASES: BreathingPhase[] = [
  { type: 'inhale', seconds: 1, cue: 'Sharp in' },
  { type: 'exhale', seconds: 1, cue: 'Sharp out' },
];

const DIAPHRAGMATIC_PHASES: BreathingPhase[] = [
  { type: 'inhale', seconds: 3, cue: 'Belly expands' },
  { type: 'hold-in', seconds: 1, cue: 'Pause' },
  { type: 'exhale', seconds: 4, cue: 'Belly falls' },
];

export const BREATHING_PATTERNS: readonly BreathingPattern[] = [
  {
    id: 'box',
    name: 'Box Breathing',
    description: 'Calms the nervous system and restores focus between heavy sets.',
    phases: BOX_PHASES,
    cycleSeconds: sumPhases(BOX_PHASES),
    recommendedFor: ['calming', 'focus', 'recovery'],
  },
  {
    id: 'four-seven-eight',
    name: '4-7-8 Breathing',
    description: 'Down-regulates sympathetic drive after a failure or max set.',
    phases: FOUR_SEVEN_EIGHT_PHASES,
    cycleSeconds: sumPhases(FOUR_SEVEN_EIGHT_PHASES),
    recommendedFor: ['calming', 'recovery'],
  },
  {
    id: 'coherent',
    name: 'Coherent Breathing',
    description: 'Even 5-5 cadence for heart-rate recovery during moderate rest.',
    phases: COHERENT_PHASES,
    cycleSeconds: sumPhases(COHERENT_PHASES),
    recommendedFor: ['recovery', 'focus', 'ready'],
  },
  {
    id: 'bellows',
    name: 'Bellows Breath',
    description: 'Quick primer to energize before an early compound set.',
    phases: BELLOWS_PHASES,
    cycleSeconds: sumPhases(BELLOWS_PHASES),
    recommendedFor: ['energizing', 'ready'],
  },
  {
    id: 'diaphragmatic',
    name: 'Diaphragmatic Breathing',
    description: 'Grounds bracing mechanics before the next lift.',
    phases: DIAPHRAGMATIC_PHASES,
    cycleSeconds: sumPhases(DIAPHRAGMATIC_PHASES),
    recommendedFor: ['ready', 'focus'],
  },
] as const;

export function getBreathingPattern(id: BreathingPatternId): BreathingPattern {
  const pattern = BREATHING_PATTERNS.find((p) => p.id === id);
  if (!pattern) {
    throw new Error(`Unknown breathing pattern: ${id}`);
  }
  return pattern;
}

export interface PickBreathingInput {
  setType: SetType;
  setIndex: number;
  totalSets: number;
  restSeconds: number;
  fatigueScore: number;
}

export function pickBreathingPattern(input: PickBreathingInput): BreathingPattern {
  const { setType, setIndex, totalSets, restSeconds, fatigueScore } = input;

  if (setType === 'failure' || fatigueScore >= 0.8) {
    return getBreathingPattern('four-seven-eight');
  }

  if (setType === 'warmup' || (setIndex === 0 && fatigueScore < 0.3)) {
    return getBreathingPattern('bellows');
  }

  if (restSeconds >= 150 || fatigueScore >= 0.6) {
    return getBreathingPattern('box');
  }

  const isLastSet = totalSets > 0 && setIndex >= totalSets - 1;
  if (isLastSet || restSeconds >= 75) {
    return getBreathingPattern('coherent');
  }

  return getBreathingPattern('diaphragmatic');
}

export function estimateCyclesInRest(pattern: BreathingPattern, restSeconds: number): number {
  if (pattern.cycleSeconds <= 0 || restSeconds <= 0) return 0;
  return Math.max(1, Math.floor(restSeconds / pattern.cycleSeconds));
}
