/**
 * coach-output-shaper
 *
 * Post-processor for raw coach responses. Applies light markdown formatting
 * and optional emoji markers so short coach replies render nicely in the
 * chat UI without requiring the model to emit markdown itself.
 *
 * Non-goals:
 *   - Not a markdown renderer.
 *   - Not a safety filter (see coach-safety.ts, expected from PR #431).
 *   - Not a prompt-injection defender (see coach-injection-hardener.ts).
 *
 * Contract:
 *   - Pure function. No network, no I/O.
 *   - Idempotent: shaping a shaped response should produce the same output.
 *   - Safe on empty / short input: returns the input (trimmed) if word count
 *     is below `maxWords` threshold.
 */

export interface ShapeOpts {
  /**
   * If the raw input has fewer than `maxWords` words (after trim) we skip
   * reformatting entirely. Defaults to 80.
   */
  maxWords?: number;
  /**
   * When false, skip emoji injection (accessibility / locale concerns).
   * Defaults to true.
   */
  emoji?: boolean;
}

const DEFAULT_MAX_WORDS = 80;

// Exercise-set pattern: e.g. "3x8 @ 165lb", "4 x 10 @ 50kg", "5x5".
// Captured so we can render each as its own bullet.
const SET_PATTERN = /(\b\d{1,2}\s*[x×]\s*\d{1,3}(?:\s*(?:@|at)\s*\d{1,4}\s*(?:lb|lbs|kg|%|rir|rpe)?)?)\b/gi;

// Intensity markers. Matched on the sentence (word-boundary, case-insensitive).
const INTENSITY_KEYWORDS = [
  /\b(?:go heavy|push hard|all[- ]out|max(?:imum)? effort|top set|rpe\s*9|rpe\s*10)\b/i,
];

// Deload markers.
const DELOAD_KEYWORDS = [
  /\b(?:deload|back off|light week|recovery week|reduce volume|drop intensity)\b/i,
];

// Nutrition markers.
const NUTRITION_KEYWORDS = [
  /\b(?:protein|calories|carbs?|macros?|hydration|water intake|meal prep|post-?workout shake)\b/i,
];

// Safety markers.
const SAFETY_KEYWORDS = [
  /\b(?:pain|injury|physician|doctor|physical therapist|see a medical|stop if|consult a|medical advice)\b/i,
];

export function shapeCoachResponse(raw: string, opts: ShapeOpts = {}): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text) return '';

  const maxWords = opts.maxWords ?? DEFAULT_MAX_WORDS;
  const emoji = opts.emoji !== false;

  const wordCount = countWords(text);
  if (wordCount < maxWords) {
    // Short enough to render as-is; still apply emoji markers only at the
    // sentence level to keep it scannable in chat bubbles.
    return emoji ? applyEmojiMarkers(text) : text;
  }

  // Step 1: extract set patterns and render as a bullet list.
  const withBullets = collapseSetPatterns(text);

  // Step 2: collapse long paragraphs into numbered lists when there are
  // 3+ sentences per paragraph.
  const withLists = numberLongParagraphs(withBullets);

  // Step 3: emoji markers (optional).
  return emoji ? applyEmojiMarkers(withLists) : withLists;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function collapseSetPatterns(text: string): string {
  const matches = text.match(SET_PATTERN);
  if (!matches || matches.length < 2) {
    return text;
  }

  // Strip duplicates and normalize whitespace inside each match.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const m of matches) {
    const normal = m.replace(/\s+/g, ' ').trim();
    if (!seen.has(normal.toLowerCase())) {
      seen.add(normal.toLowerCase());
      unique.push(normal);
    }
  }
  if (unique.length < 2) {
    return text;
  }

  // Replace the first match run with a bullet list, drop subsequent inline
  // references to those sets (keep the rest of the prose intact).
  const firstIndex = text.search(SET_PATTERN);
  if (firstIndex < 0) return text;

  const prefix = text.slice(0, firstIndex).trim();
  // Remove captured set strings from the tail so we don't duplicate info.
  let tail = text.slice(firstIndex);
  for (const m of unique) {
    tail = tail.replace(m, '');
  }
  tail = tail.replace(/\s{2,}/g, ' ').trim();
  tail = tail.replace(/^[,.;:\s]+/, '');

  const bulletBlock = unique.map((m) => `- ${m}`).join('\n');
  const parts = [prefix, bulletBlock, tail].filter((s) => s.length > 0);
  return parts.join('\n\n');
}

function numberLongParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para.startsWith('- ') || /^\d+\.\s/.test(para)) {
      // Already a list; leave it alone.
      out.push(para);
      continue;
    }
    const sentences = splitSentences(para);
    if (sentences.length >= 3) {
      const numbered = sentences
        .map((s, i) => `${i + 1}. ${s.trim()}`)
        .join('\n');
      out.push(numbered);
    } else {
      out.push(para);
    }
  }
  return out.join('\n\n');
}

function splitSentences(text: string): string[] {
  // Naive splitter: breaks on ". " "! " "? " preserving punctuation.
  const parts = text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

function applyEmojiMarkers(text: string): string {
  const lines = text.split('\n');
  const shaped: string[] = [];
  for (const line of lines) {
    shaped.push(annotateLine(line));
  }
  return shaped.join('\n');
}

function annotateLine(line: string): string {
  if (!line.trim()) return line;
  // Skip lines that already start with an emoji marker to stay idempotent.
  if (/^\s*(?:⚡|⬇️|🍽️|⚠️)/.test(line)) return line;

  let marker = '';
  if (SAFETY_KEYWORDS.some((re) => re.test(line))) marker = '⚠️';
  else if (INTENSITY_KEYWORDS.some((re) => re.test(line))) marker = '⚡';
  else if (DELOAD_KEYWORDS.some((re) => re.test(line))) marker = '⬇️';
  else if (NUTRITION_KEYWORDS.some((re) => re.test(line))) marker = '🍽️';

  if (!marker) return line;

  // If the line begins with a bullet/number prefix, insert the marker after it.
  const bulletMatch = line.match(/^(\s*(?:-\s+|\d+\.\s+))(.*)$/);
  if (bulletMatch) {
    return `${bulletMatch[1]}${marker} ${bulletMatch[2]}`;
  }
  return `${marker} ${line}`;
}
