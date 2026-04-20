/**
 * Cooldown Generator Prompt Builder
 */
import { getFewShots } from './template-generation-few-shots';
import type { CoachMessage } from './coach-service';

export interface CooldownGeneratorInput {
  /** Exercise slugs the user just completed. */
  readonly completedExerciseSlugs: readonly string[];
  /** Overall session RPE 1-10 (optional). */
  readonly sessionRpe?: number;
  /** Target duration in minutes (default 5-10). */
  readonly durationMin?: number;
  /** Optional extra context (e.g. "low back tight"). */
  readonly userContext?: string;
}

const SYSTEM_PROMPT = [
  'You are a post-session cooldown generator for the Form Factor fitness app.',
  'Given the completed exercises + session RPE, produce a stretch/recovery routine in JSON.',
  'Required shape: { name: string, duration_min: number, movements: Array<{ name: string, duration_seconds?: number, reps?: number, focus: "stretch"|"breathing"|"cardio"|"activation", intensity: "low"|"medium"|"high", notes?: string }>, reflection_prompt?: string }.',
  'Rules:',
  '- Output JSON ONLY. No prose, no markdown fences.',
  '- 3-6 movements, total duration ~5-12 min.',
  '- Lean on stretch + breathing for high-RPE sessions; include light cardio for moderate RPE.',
  '- Include a single-line reflection_prompt that invites the user to note sensations or cues.',
].join('\n');

export function buildCooldownGeneratorMessages(input: CooldownGeneratorInput): CoachMessage[] {
  const fewShots = getFewShots({
    domain: 'cooldown',
    durationMin: input.durationMin,
    limit: 2,
  });

  const messages: CoachMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of fewShots) {
    messages.push({ role: 'user', content: ex.prompt });
    messages.push({ role: 'assistant', content: ex.response });
  }

  const parts: string[] = [];
  parts.push(`Completed exercises: ${input.completedExerciseSlugs.join(', ')}`);
  if (input.sessionRpe != null) parts.push(`Session RPE: ${input.sessionRpe}`);
  if (input.durationMin != null) parts.push(`Target duration: ${input.durationMin} min`);
  if (input.userContext && input.userContext.trim().length > 0) {
    parts.push(`User context: ${input.userContext.trim()}`);
  }
  parts.push('Respond with JSON only.');

  messages.push({ role: 'user', content: parts.join('\n') });
  return messages;
}

export const COOLDOWN_GENERATOR_SYSTEM_PROMPT = SYSTEM_PROMPT;
