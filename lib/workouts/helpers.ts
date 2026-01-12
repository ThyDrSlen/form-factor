import type { WorkoutDefinition, WorkoutMetrics } from '@/lib/types/workout-definitions';

export function getPhaseStaticCue<P extends string, M extends WorkoutMetrics>(
  definition: WorkoutDefinition<P, M>,
  phaseId: P
): string | null;
export function getPhaseStaticCue(
  definition: WorkoutDefinition<any, any>,
  phaseId: string
): string | null;
export function getPhaseStaticCue(
  definition: WorkoutDefinition<any, any>,
  phaseId: string
): string | null {
  return definition.phases.find((phase) => phase.id === phaseId)?.staticCue ?? null;
}
