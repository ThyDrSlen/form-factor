/**
 * Session Generator Prompt Builder
 *
 * Composes the system + few-shot + user prompt for NL → WorkoutTemplate generation.
 * Kept separate from the generator service so it can be unit tested in isolation.
 */
import type { GoalProfile } from '@/lib/types/workout-session';
import { getFewShots } from './template-generation-few-shots';
import type { CoachMessage } from './coach-service';

export interface SessionGeneratorInput {
  /** User's natural-language description, e.g. "pushups + pullups, 30 min, home". */
  readonly intent: string;
  /** Preferred goal profile. Used to filter few-shots and bias LLM. */
  readonly goalProfile?: GoalProfile;
  /** Available equipment, e.g. ['barbell', 'bench'] or ['bodyweight']. */
  readonly equipment?: readonly string[];
  /** Target session duration in minutes. */
  readonly durationMin?: number;
  /** Known exercise slugs available in the user's catalog. Biases LLM toward these. */
  readonly availableExerciseSlugs?: readonly string[];
}

const SYSTEM_PROMPT = [
  'You are a workout template generator for the Form Factor fitness app.',
  'Given a user intent, produce a JSON object describing a complete workout template.',
  'Required shape: { name: string, description: string, goal_profile: "hypertrophy"|"strength"|"power"|"endurance"|"mixed", exercises: Array<{ exercise_slug: string, sets: Array<{ target_reps?: number, target_seconds?: number, target_weight?: number, target_rpe?: number, set_type?: "normal"|"warmup"|"amrap"|"failure"|"timed" }>, default_rest_seconds?: number, notes?: string }> }.',
  'Rules:',
  '- Output JSON ONLY. No prose, no markdown fences.',
  '- Prefer exercise_slug values from the user\'s catalog if provided.',
  '- Keep exercises reasonable for the target duration (plan ~60-90s per set + rest).',
  '- Use target_rpe 6-9 for working sets; omit for bodyweight-only unless meaningful.',
  '- Never invent unsafe loads — if the user gives no weight context, omit target_weight.',
  '- Short output: aim for 2-6 exercises unless explicitly requested otherwise.',
].join('\n');

/**
 * Build the coach-service message sequence for the session generator.
 */
export function buildSessionGeneratorMessages(input: SessionGeneratorInput): CoachMessage[] {
  const fewShots = getFewShots({
    domain: 'session',
    goalProfile: input.goalProfile,
    durationMin: input.durationMin,
    limit: 3,
  });

  const messages: CoachMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  for (const ex of fewShots) {
    messages.push({ role: 'user', content: ex.prompt });
    messages.push({ role: 'assistant', content: ex.response });
  }

  messages.push({ role: 'user', content: buildUserLine(input) });

  return messages;
}

function buildUserLine(input: SessionGeneratorInput): string {
  const parts: string[] = [];
  parts.push(`Intent: ${input.intent.trim()}`);
  if (input.goalProfile) parts.push(`Goal profile: ${input.goalProfile}`);
  if (input.durationMin != null) parts.push(`Duration: ${input.durationMin} min`);
  if (input.equipment && input.equipment.length > 0) {
    parts.push(`Equipment: ${input.equipment.join(', ')}`);
  }
  if (input.availableExerciseSlugs && input.availableExerciseSlugs.length > 0) {
    parts.push(`Prefer exercise_slug from: [${input.availableExerciseSlugs.join(', ')}]`);
  }
  parts.push('Respond with JSON only.');
  return parts.join('\n');
}

/** Exported for tests. */
export const SESSION_GENERATOR_SYSTEM_PROMPT = SYSTEM_PROMPT;
