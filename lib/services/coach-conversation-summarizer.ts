/**
 * coach-conversation-summarizer
 *
 * Rolling-window compression for coach message history. When a conversation
 * grows past a threshold we replace the oldest turns with a single canned
 * summary bullet so the model keeps seeing recent detail without blowing
 * the token budget.
 *
 * Design
 *   - Pure, deterministic, zero I/O. Summaries are generated from a small
 *     set of topic heuristics (no network calls, no external LLM).
 *   - Gated on EXPO_PUBLIC_COACH_MEMORY_COMPRESS — callers should read the
 *     flag themselves; this module can be called directly by tests.
 *   - Non-destructive: if the history is already below `summarizeBelow`
 *     turns we return the original array.
 *
 * Integration: coach-service.ts applies this immediately before dispatch
 * when the flag is set. See commit "wire shaper/cache/summarizer".
 */

export type CoachRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: CoachRole;
  content: string;
  id?: string;
}

export interface SummarizerOpts {
  /**
   * Number of most-recent messages we keep untouched at the tail. Defaults to 4
   * (two full user/assistant exchanges).
   */
  keepLast?: number;
  /**
   * If total messages is below this, return the input as-is. Defaults to 8.
   */
  summarizeBelow?: number;
}

interface TopicMatch {
  topic: string;
}

/** Tiny topic taxonomy. Order matters; first match wins. */
const TOPICS: { pattern: RegExp; topic: string }[] = [
  { pattern: /\b(?:squat|squatted|leg day)\b/i, topic: 'squat form' },
  { pattern: /\b(?:deadlift|pulled from the floor)\b/i, topic: 'deadlift form' },
  { pattern: /\b(?:bench|bench press|pressing)\b/i, topic: 'bench press' },
  { pattern: /\b(?:pull[- ]?up|chin[- ]?up)\b/i, topic: 'pullups' },
  { pattern: /\b(?:push[- ]?up|press[- ]?up)\b/i, topic: 'pushups' },
  { pattern: /\b(?:row|rowing)\b/i, topic: 'rows' },
  { pattern: /\b(?:protein|calories|carbs?|macros?|meal|nutrition|diet)\b/i, topic: 'nutrition' },
  { pattern: /\b(?:sleep|recovery|rest day|deload)\b/i, topic: 'recovery' },
  { pattern: /\b(?:pain|injury|physician|doctor)\b/i, topic: 'an injury concern' },
  { pattern: /\b(?:weight loss|cutting|surplus|bulking)\b/i, topic: 'body composition' },
];

const DEFAULT_KEEP_LAST = 4;
const DEFAULT_SUMMARIZE_BELOW = 8;

export function summarizeRollingWindow(
  messages: Message[],
  opts: SummarizerOpts = {}
): Message[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const keepLast = Math.max(1, opts.keepLast ?? DEFAULT_KEEP_LAST);
  const summarizeBelow = Math.max(keepLast + 1, opts.summarizeBelow ?? DEFAULT_SUMMARIZE_BELOW);

  if (messages.length < summarizeBelow) return messages.slice();

  // Always preserve system messages verbatim at the head.
  const systemHead: Message[] = [];
  let idx = 0;
  while (idx < messages.length && messages[idx].role === 'system') {
    systemHead.push(messages[idx]);
    idx += 1;
  }

  const body = messages.slice(idx);
  if (body.length <= keepLast) {
    return [...systemHead, ...body];
  }

  const tail = body.slice(-keepLast);
  const toSummarize = body.slice(0, body.length - keepLast);

  const summary = buildSummaryMessage(toSummarize);
  const result = [...systemHead];
  if (summary) result.push(summary);
  result.push(...tail);
  return result;
}

function buildSummaryMessage(messages: Message[]): Message | null {
  if (messages.length === 0) return null;

  const userTurnCount = messages.filter((m) => m.role === 'user').length;
  const topics = detectTopics(messages);
  const turnPhrase = formatTurnPhrase(userTurnCount);

  const topicPhrase =
    topics.length === 0
      ? 'earlier coaching discussion'
      : topics.length === 1
        ? topics[0].topic
        : `${topics.slice(0, -1).map((t) => t.topic).join(', ')} and ${topics[topics.length - 1].topic}`;

  const content = `[conversation summary] Discussed ${topicPhrase} ${turnPhrase}.`;

  return {
    role: 'system',
    content,
  };
}

function detectTopics(messages: Message[]): TopicMatch[] {
  const matched: TopicMatch[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.role === 'system') continue;
    for (const t of TOPICS) {
      if (t.pattern.test(m.content) && !seen.has(t.topic)) {
        seen.add(t.topic);
        matched.push({ topic: t.topic });
      }
    }
  }
  return matched.slice(0, 3);
}

function formatTurnPhrase(userTurns: number): string {
  if (userTurns <= 1) return '1 turn ago';
  return `${userTurns} turns ago`;
}
