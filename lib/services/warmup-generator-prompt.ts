/**
 * Warmup Generator Prompt Builder
 *
 * Composes the system + few-shot + user prompt for pre-session warmup generation.
 */
import { getFewShots } from './template-generation-few-shots';
import type { CoachMessage } from './coach-service';

export interface WarmupGeneratorInput {
  /** Slugs of the main-session exercises this warmup precedes. */
  readonly exerciseSlugs: readonly string[];
  /** Target duration in minutes (default 5-10). */
  readonly durationMin?: number;
  /** Optional context the user wants the warmup to address. */
  readonly userContext?: string;
}

const SYSTEM_PROMPT = [
  'You are a pre-session warmup generator for the Form Factor fitness app.',
  'Given the main-session exercises, produce a short mobility + activation routine in JSON.',
  'Required shape: { name: string, duration_min: number, movements: Array<{ name: string, duration_seconds?: number, reps?: number, focus: "mobility"|"activation"|"cardio"|"breathing", intensity: "low"|"medium"|"high", notes?: string }> }.',
  'Rules:',
  '- Output JSON ONLY. No prose, no markdown fences.',
  '- 3-7 movements, total duration ~5-10 min unless user specifies otherwise.',
  '- Progress from low-intensity mobility to moderate activation.',
  '- Each movement must include EITHER duration_seconds OR reps (not both required).',
  '- Map movements to the upcoming exercises (warm the same joints and patterns).',
].join('\n');

export function buildWarmupGeneratorMessages(input: WarmupGeneratorInput): CoachMessage[] {
  const fewShots = getFewShots({
    domain: 'warmup',
    durationMin: input.durationMin,
    limit: 2,
  });

  const messages: CoachMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of fewShots) {
    messages.push({ role: 'user', content: ex.prompt });
    messages.push({ role: 'assistant', content: ex.response });
  }

  const parts: string[] = [];
  parts.push(`Upcoming exercises: ${input.exerciseSlugs.join(', ')}`);
  if (input.durationMin != null) parts.push(`Target duration: ${input.durationMin} min`);
  if (input.userContext && input.userContext.trim().length > 0) {
    parts.push(`User context: ${input.userContext.trim()}`);
  }
  parts.push('Respond with JSON only.');

  messages.push({ role: 'user', content: parts.join('\n') });
  return messages;
}

export const WARMUP_GENERATOR_SYSTEM_PROMPT = SYSTEM_PROMPT;
