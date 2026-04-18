/**
 * Gemma Prompt Format
 *
 * Renders a CoachMessage[] for either Gemma 3 or Gemma 4 chat templates.
 *
 * Key differences between generations:
 *   - Gemma 3 does NOT support a dedicated system role. The canonical
 *     workaround is to prepend system content to the first user turn.
 *   - Gemma 4 supports a native system role via <start_of_turn>system.
 *   - Both generations use the `<start_of_turn>{role}\n...<end_of_turn>`
 *     framing and map `assistant` → `model`.
 *
 * This helper is format-only. It does not send anything and does not depend
 * on the runtime — useful for PR #457 (Gemma via Gemini API) and PR #431
 * (on-device via executorch / MediaPipe) alike.
 */

import type { CoachMessage } from './coach-service';

export type GemmaTarget = 'gemma-3' | 'gemma-4';
export type GemmaMessageRole = 'system' | 'user' | 'model';

export interface GemmaMessage {
  role: GemmaMessageRole;
  content: string;
}

const START = '<start_of_turn>';
const END = '<end_of_turn>';

export function mapCoachRoleToGemma(role: CoachMessage['role']): GemmaMessageRole {
  if (role === 'assistant') return 'model';
  if (role === 'system') return 'system';
  return 'user';
}

/**
 * Map coach-service messages into Gemma message shape for the given target.
 * For `gemma-3`, system turns are folded into the first user turn — this
 * keeps behavior deterministic across the two generations.
 */
export function formatGemmaMessages(
  messages: CoachMessage[],
  target: GemmaTarget
): GemmaMessage[] {
  if (target === 'gemma-4') {
    return messages.map((m) => ({
      role: mapCoachRoleToGemma(m.role),
      content: m.content,
    }));
  }

  const systemPieces: string[] = [];
  const rest: CoachMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemPieces.push(m.content);
    } else {
      rest.push(m);
    }
  }

  const systemPrefix = systemPieces.join('\n\n');
  const mapped: GemmaMessage[] = [];

  let systemInjected = systemPrefix.length === 0;
  for (const m of rest) {
    const role = mapCoachRoleToGemma(m.role);
    if (!systemInjected && role === 'user') {
      mapped.push({ role: 'user', content: `${systemPrefix}\n\n${m.content}`.trim() });
      systemInjected = true;
    } else {
      mapped.push({ role, content: m.content });
    }
  }

  if (!systemInjected && systemPrefix.length > 0) {
    mapped.unshift({ role: 'user', content: systemPrefix });
  }

  return mapped;
}

/**
 * Render Gemma messages into the chat-template control-token string.
 * Appends a trailing `<start_of_turn>model\n` to signal the model should
 * produce the next turn, matching the Gemma chat template convention.
 */
export function renderGemmaChatPrompt(
  messages: GemmaMessage[],
  target: GemmaTarget
): string {
  if (target === 'gemma-3' && messages.some((m) => m.role === 'system')) {
    throw new Error('gemma-3 does not support system turns — fold them into the first user turn first');
  }
  const lines: string[] = [];
  for (const m of messages) {
    lines.push(`${START}${m.role}\n${m.content}${END}`);
  }
  lines.push(`${START}model\n`);
  return lines.join('\n');
}

export interface GemmaFormatValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a rendered Gemma chat prompt against the target's rules.
 * Catches the common drift cases:
 *   - system role present on gemma-3
 *   - missing trailing model turn
 *   - unbalanced start/end tokens
 *   - role other than system|user|model
 */
export function validateGemmaFormat(prompt: string, target: GemmaTarget): GemmaFormatValidationResult {
  const errors: string[] = [];
  const startCount = (prompt.match(/<start_of_turn>/g) ?? []).length;
  const endCount = (prompt.match(/<end_of_turn>/g) ?? []).length;

  if (startCount === 0) {
    errors.push('prompt contains no <start_of_turn> markers');
  }
  if (startCount !== endCount + 1) {
    errors.push(
      `unbalanced turn markers: ${startCount} starts, ${endCount} ends — expected exactly one open trailing turn`
    );
  }
  if (!/<start_of_turn>model\n?$/.test(prompt)) {
    errors.push('prompt must end with <start_of_turn>model to request the next turn');
  }

  const roleMatches = prompt.matchAll(/<start_of_turn>(system|user|model|[^\n]+)\n/g);
  for (const match of roleMatches) {
    const role = match[1].trim();
    if (role !== 'system' && role !== 'user' && role !== 'model') {
      errors.push(`unexpected role "${role}" — must be one of system|user|model`);
    }
    if (target === 'gemma-3' && role === 'system') {
      errors.push('gemma-3 does not support the system role');
    }
  }

  return { valid: errors.length === 0, errors };
}
