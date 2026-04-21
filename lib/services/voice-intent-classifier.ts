/**
 * Voice Intent Classifier (#469)
 *
 * Pure-TypeScript intent classification for hands-free voice control during
 * form-tracking sessions. No ML — regex + lightweight Levenshtein-style
 * fuzzy matching to tolerate noisy STT transcripts ("nexts", "pouse"…).
 *
 * Designed to be cheap and deterministic:
 *   - classifyIntent(transcript) → { intent, params, confidence }
 *   - Confidence is a float in [0, 1]
 *   - confidence < 0.70 returns intent: 'none'
 *   - Numeric params are extracted and normalized (unit → kg/lb/rpe scalar)
 *
 * The classifier is the ONLY place voice text enters the system; downstream
 * code (voice-command-executor) operates on typed intents only. This isolates
 * the privacy boundary: transcripts never leak past this module.
 */
/**
 * Units system: 'metric' → kg, 'imperial' → lb. Mirrors the shape used by
 * contexts/UnitsContext without introducing a dependency — the classifier is
 * pure and must not import React contexts.
 */
export type WeightPreference = 'metric' | 'imperial';

export type VoiceIntent =
  | 'none'
  | 'next'
  | 'pause'
  | 'resume'
  | 'skip_rest'
  | 'add_weight'
  | 'log_rpe'
  | 'restart';

export interface IntentParams {
  /** Numeric weight value (non-normalized — executor owns the unit math). */
  weight?: number;
  /** Weight unit as recognized from the utterance. */
  weightUnit?: 'kg' | 'lb';
  /** Rate of perceived exertion (1-10 scale). */
  rpe?: number;
}

export interface ClassifiedIntent {
  intent: VoiceIntent;
  params: IntentParams;
  /** Confidence in [0, 1]. Below CONFIDENCE_THRESHOLD returns intent 'none'. */
  confidence: number;
  /** Normalized transcript used for matching — useful for UI feedback. */
  normalized: string;
}

export const CONFIDENCE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

interface IntentPattern {
  intent: Exclude<VoiceIntent, 'none' | 'add_weight' | 'log_rpe'>;
  /** Exact phrases — highest confidence (1.0). */
  exact: string[];
  /** Fuzzy phrases — matched via Levenshtein <= 1 for short words, <=2 for long. */
  fuzzy: string[];
  /** Substring phrases — medium confidence (0.80). */
  substring: string[];
}

const PATTERNS: IntentPattern[] = [
  {
    intent: 'next',
    exact: ['next', 'skip', 'move on', 'next exercise', 'next set', 'go on'],
    fuzzy: ['next', 'skip'],
    substring: ['next', 'skip', 'move on', 'next exercise', 'next set'],
  },
  {
    intent: 'pause',
    exact: ['pause', 'hold', 'wait', 'hold on', 'pause session', 'pause workout'],
    fuzzy: ['pause', 'hold', 'wait'],
    substring: ['pause', 'hold on', 'wait up'],
  },
  {
    intent: 'resume',
    exact: ['resume', 'go', 'continue', 'go on', 'resume session', "let's go"],
    fuzzy: ['resume', 'continue'],
    substring: ['resume', 'continue', "let's go", 'lets go', 'keep going'],
  },
  {
    intent: 'skip_rest',
    exact: ['skip rest', 'done resting', 'end rest', 'no rest', 'skip the rest'],
    fuzzy: ['skip rest', 'done resting', 'end rest'],
    substring: ['skip rest', 'done resting', 'end rest', 'no rest', 'skip the rest'],
  },
  {
    intent: 'restart',
    exact: ['restart', 'redo', 'start over', 'restart set', 'redo set'],
    fuzzy: ['restart', 'redo'],
    substring: ['restart', 'redo', 'start over', 'do over'],
  },
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Lowercase, collapse whitespace, strip trailing punctuation. Keeps internal
 * punctuation like "rpe 8" intact.
 */
export function normalizeTranscript(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Strip a leading wake-word so "hey form next exercise" becomes "next exercise"
 * without changing the intent mapping. Voice-session-manager also filters,
 * but the classifier is tolerant in case callers forget.
 */
export function stripWakeWord(input: string): string {
  return input
    .replace(/^\s*(hey\s+form|hey\s+coach|coach)\s*,?\s*/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Levenshtein (iterative, two-row)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  let curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function allowedDistance(word: string): number {
  if (word.length <= 4) return 1;
  if (word.length <= 8) return 2;
  return 3;
}

function fuzzyMatches(transcript: string, phrase: string): boolean {
  // Exact substring wins first
  if (transcript.includes(phrase)) return true;
  // For short phrases, try whole-transcript distance
  if (phrase.length <= 6) {
    return levenshtein(transcript, phrase) <= allowedDistance(phrase);
  }
  // For longer phrases, compare word-by-word
  const tWords = transcript.split(' ');
  const pWords = phrase.split(' ');
  if (pWords.length > tWords.length) return false;
  for (let i = 0; i + pWords.length <= tWords.length; i++) {
    let ok = true;
    for (let j = 0; j < pWords.length; j++) {
      if (levenshtein(tWords[i + j], pWords[j]) > allowedDistance(pWords[j])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Numeric param extraction
// ---------------------------------------------------------------------------

/**
 * Extract add-weight intent + params from a normalized transcript.
 * Recognised forms:
 *   "add weight 10" / "add 10 kg" / "add 10 pounds" / "plus 5" / "plus 2.5 kg"
 */
function tryExtractAddWeight(
  transcript: string,
): { params: IntentParams; confidence: number } | null {
  const patterns: { re: RegExp; conf: number }[] = [
    // "add weight 10 kg" / "add weight 10"
    { re: /\badd\s+weight\s+([\d.]+)\s*(kg|kilos?|kilograms?|lb|lbs|pounds?)?/i, conf: 0.96 },
    // "plus 10 kg" / "plus 10"
    { re: /\bplus\s+([\d.]+)\s*(kg|kilos?|kilograms?|lb|lbs|pounds?)?/i, conf: 0.92 },
    // "add 10 kg" / "add 10 pounds"
    { re: /\badd\s+([\d.]+)\s*(kg|kilos?|kilograms?|lb|lbs|pounds?)\b/i, conf: 0.9 },
    // "increase weight to 10"
    { re: /\bincrease\s+weight\s+(?:by|to)?\s*([\d.]+)\s*(kg|kilos?|kilograms?|lb|lbs|pounds?)?/i, conf: 0.85 },
  ];
  for (const { re, conf } of patterns) {
    const m = transcript.match(re);
    if (!m) continue;
    const value = parseFloat(m[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const unitRaw = (m[2] ?? '').toLowerCase();
    const weightUnit: 'kg' | 'lb' | undefined = unitRaw
      ? /kg|kilo/.test(unitRaw)
        ? 'kg'
        : 'lb'
      : undefined;
    return { params: { weight: value, weightUnit }, confidence: conf };
  }
  return null;
}

/**
 * Extract RPE intent + params. Recognised forms:
 *   "log rpe 8" / "rpe 9" / "log rpe eight" (digit only for now).
 */
function tryExtractRpe(transcript: string): { params: IntentParams; confidence: number } | null {
  const patterns: { re: RegExp; conf: number }[] = [
    { re: /\blog\s+rpe\s+(\d{1,2}(?:\.\d)?)\b/i, conf: 0.95 },
    { re: /\brpe\s+(\d{1,2}(?:\.\d)?)\b/i, conf: 0.9 },
    { re: /\brate\s+(?:it\s+)?(\d{1,2}(?:\.\d)?)\b/i, conf: 0.78 },
  ];
  for (const { re, conf } of patterns) {
    const m = transcript.match(re);
    if (!m) continue;
    const rpe = parseFloat(m[1]);
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) continue;
    return { params: { rpe }, confidence: conf };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification entry point
// ---------------------------------------------------------------------------

/**
 * Classify a raw STT transcript into a voice intent.
 *
 * @param raw — a single utterance from the STT layer (may include the wake word).
 * @returns an {@link ClassifiedIntent}. Always returns a well-formed object;
 *          low-confidence or unrecognized transcripts map to intent 'none'.
 */
export function classifyIntent(raw: string): ClassifiedIntent {
  const stripped = stripWakeWord(raw ?? '');
  const transcript = normalizeTranscript(stripped);
  if (!transcript) {
    return { intent: 'none', params: {}, confidence: 0, normalized: '' };
  }

  // 1. Numeric intents first — they carry params and are less likely to false-positive.
  const addWeight = tryExtractAddWeight(transcript);
  if (addWeight && addWeight.confidence >= CONFIDENCE_THRESHOLD) {
    return {
      intent: 'add_weight',
      params: addWeight.params,
      confidence: addWeight.confidence,
      normalized: transcript,
    };
  }

  const rpe = tryExtractRpe(transcript);
  if (rpe && rpe.confidence >= CONFIDENCE_THRESHOLD) {
    return {
      intent: 'log_rpe',
      params: rpe.params,
      confidence: rpe.confidence,
      normalized: transcript,
    };
  }

  // 2. Phrase intents: try exact → substring → fuzzy in priority order.
  let best: { intent: VoiceIntent; confidence: number } = { intent: 'none', confidence: 0 };

  for (const p of PATTERNS) {
    if (p.exact.includes(transcript)) {
      if (1 > best.confidence) best = { intent: p.intent, confidence: 1 };
      continue;
    }
    // Substring match
    if (p.substring.some((s) => transcript.includes(s))) {
      if (0.85 > best.confidence) best = { intent: p.intent, confidence: 0.85 };
      continue;
    }
    // Fuzzy
    if (p.fuzzy.some((f) => fuzzyMatches(transcript, f))) {
      if (0.75 > best.confidence) best = { intent: p.intent, confidence: 0.75 };
    }
  }

  if (best.confidence < CONFIDENCE_THRESHOLD) {
    return { intent: 'none', params: {}, confidence: best.confidence, normalized: transcript };
  }

  return { intent: best.intent, params: {}, confidence: best.confidence, normalized: transcript };
}

/**
 * Convenience: apply the caller's preferred unit if the user omitted one.
 * Does not participate in classification — lives here for colocation.
 */
export function resolveWeightUnit(
  params: IntentParams,
  preferred: WeightPreference,
): 'kg' | 'lb' {
  if (params.weightUnit) return params.weightUnit;
  return preferred === 'metric' ? 'kg' : 'lb';
}

// ---------------------------------------------------------------------------
// Gemma NLU fallback (#wave24-voice)
// ---------------------------------------------------------------------------

/**
 * Async classifier that routes low-confidence transcripts to a Gemma NLU
 * prompt when the voice-control pipeline flag is on. The sync
 * `classifyIntent` is unchanged — callers that want the fallback behavior
 * opt in by calling this async variant.
 *
 * Fail-safe defaults:
 *   - Flag off → identical to `classifyIntent` (never touches Gemma).
 *   - Gemma throws / times out → fall back to the regex result.
 *
 * The classifier module does not import `coach-service` directly; the
 * caller injects the `sendPrompt` function. This keeps the voice
 * subsystem unit-testable without a live edge function + avoids any
 * hard coupling between the voice path and the coach path.
 */
export interface ClassifyIntentWithFallbackOptions {
  /** Read the master flag — injected so tests can force-enable/disable. */
  isPipelineEnabled?: () => boolean;
  /** Gemma NLU dispatcher — injected so tests can stub the reply. */
  sendGemmaPrompt?: (
    transcript: string,
  ) => Promise<ClassifiedIntent>;
}

export async function classifyIntentWithFallback(
  raw: string,
  options: ClassifyIntentWithFallbackOptions = {},
): Promise<ClassifiedIntent> {
  const primary = classifyIntent(raw);
  if (primary.intent !== 'none') return primary;

  // Lazy import so the sync classifier has no dependency on the flag
  // module (keeps static analysis clean).
  const {
    isVoiceControlPipelineEnabled,
  }: typeof import('./voice-pipeline-flag') =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./voice-pipeline-flag');
  const pipelineOn = (options.isPipelineEnabled ?? isVoiceControlPipelineEnabled)();
  if (!pipelineOn) return primary;

  // Resolve the Gemma dispatcher. Default wires the prompt builder to
  // `sendCoachPrompt`; tests inject a mock.
  const dispatcher =
    options.sendGemmaPrompt ??
    (async (transcript: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { classifyViaGemma }: typeof import('./voice-gemma-nlu-fallback') =
        require('./voice-gemma-nlu-fallback');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendCoachPrompt }: typeof import('./coach-service') =
        require('./coach-service');
      return classifyViaGemma(transcript, sendCoachPrompt);
    });

  const transcript = primary.normalized || stripWakeWord(raw ?? '');
  const fallback = await dispatcher(transcript);
  // Prefer the fallback ONLY when it crosses the confidence threshold;
  // otherwise stick with the primary 'none'.
  if (fallback.intent !== 'none' && fallback.confidence >= CONFIDENCE_THRESHOLD) {
    return fallback;
  }
  return primary;
}
