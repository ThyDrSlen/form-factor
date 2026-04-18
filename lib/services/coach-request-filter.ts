/**
 * Coach request-scope filter — classifies whether a user prompt is on-topic
 * for the fitness coach. Runs BEFORE we spend tokens on the model, so
 * off-topic prompts get a cheap canned reply instead of burning budget on
 * small talk or irrelevant questions.
 *
 * This file is intentionally a pure function with zero dependencies. Other
 * coach code can import and call it without introducing new imports.
 */

// =============================================================================
// Types
// =============================================================================

export type RequestCategory =
  | 'fitness'
  | 'form'
  | 'nutrition'
  | 'recovery'
  | 'workout_planning'
  | 'unknown';

export type RejectReason =
  | 'off_topic'
  | 'unsafe'
  | 'meta_prompt_attack'
  | 'empty';

export interface RequestClassification {
  allow: boolean;
  category: RequestCategory;
  /** Signals considered in classification — useful for eval. */
  matchedKeywords: string[];
  /** Present only when `allow === false`. */
  rejectReason?: RejectReason;
  /** Copy the caller can surface as the canned off-topic reply. */
  suggestedResponse?: string;
}

// =============================================================================
// Vocabulary
// =============================================================================

const CATEGORY_VOCAB: Record<
  Exclude<RequestCategory, 'unknown'>,
  readonly string[]
> = {
  fitness: [
    'workout',
    'workouts',
    'training',
    'exercise',
    'exercises',
    'rep',
    'reps',
    'lifting',
    'strength',
    'cardio',
    'hiit',
    'flexibility',
    'pr',
    'personal record',
    '1rm',
    'one rep max',
    'gym',
    'periodize',
    'periodization',
  ],
  form: [
    'form',
    'technique',
    'squat',
    'squats',
    'deadlift',
    'deadlifts',
    'bench',
    'pullup',
    'pullups',
    'pull-up',
    'pull up',
    'pushup',
    'pushups',
    'push-up',
    'push up',
    'rdl',
    'hinge',
    'depth',
    'rom',
    'range of motion',
    'valgus',
    'cue',
    'fault',
    'posture',
    'brace',
    'lockout',
  ],
  nutrition: [
    'protein',
    'calorie',
    'calories',
    'carb',
    'carbs',
    'fat',
    'fats',
    'macro',
    'macros',
    'diet',
    'nutrition',
    'meal',
    'eat',
    'food',
    'supplement',
    'creatine',
    'hydration',
    'water',
    'fasted',
  ],
  recovery: [
    'recovery',
    'rest',
    'sleep',
    'sore',
    'soreness',
    'doms',
    'deload',
    'overtraining',
    'fatigue',
    'warmup',
    'warm-up',
    'cooldown',
    'cool-down',
    'mobility',
    'stretch',
    'stretches',
    'stretching',
    'foam roll',
  ],
  workout_planning: [
    'program',
    'programming',
    'split',
    'push pull legs',
    'ppl',
    'upper lower',
    'full body',
    'template',
    'schedule',
    'routine',
    'cycle',
    'mesocycle',
    'progression',
    'overload',
  ],
};

/**
 * Tie-break priority when multiple categories have equal keyword match counts.
 * Recovery first (lots of ambiguous exercise-adjacent words), then form (most
 * specific lift names), nutrition, workout_planning, and finally fitness
 * (catch-all).
 */
const CATEGORY_PRIORITY: ReadonlyArray<Exclude<RequestCategory, 'unknown'>> = [
  'recovery',
  'form',
  'nutrition',
  'workout_planning',
  'fitness',
];

const UNSAFE_PATTERNS: readonly RegExp[] = [
  /\b(anabolic )?steroid(s)?\b/i,
  /\btren(bolone)?\b/i,
  /\b(sarms?|ostarine|rad-?140|lgd-?4033|mk-?677)\b/i,
  /\bpe(p|p)?tides?\b.*\b(inject|order|cycle)\b/i,
  /\b(ghb|gbl|dnp)\b/i,
  /\b(hgh|human growth hormone)\b/i,
];

const META_ATTACK_PATTERNS: readonly RegExp[] = [
  /ignore (all )?(previous|prior|above) (instructions|prompts)/i,
  /you are (now|actually) (a|an|my) .+ (and|that) (will|must|should)/i,
  /system prompt/i,
  /reveal (your|the) (system )?prompt/i,
  /pretend (to be|you are)/i,
];

// Short, obviously-off-topic vocabulary. Keep tight — false positives are
// expensive here.
const OFF_TOPIC_HINTS: readonly string[] = [
  'stock',
  'stocks',
  'bitcoin',
  'crypto',
  'recipe for',
  'python code',
  'javascript',
  'typescript',
  'write a poem',
  'tell me a joke',
];

// =============================================================================
// Public API
// =============================================================================

/**
 * Classify a raw user prompt against the coach's scope.
 * Does not normalize further than lowercasing — callers can apply their
 * own pre-processing (typo correction, emoji stripping) beforehand.
 */
export function classifyCoachRequest(
  prompt: string,
): RequestClassification {
  if (!prompt || prompt.trim().length === 0) {
    return {
      allow: false,
      category: 'unknown',
      matchedKeywords: [],
      rejectReason: 'empty',
      suggestedResponse: 'Send a question about your training and I\'ll help.',
    };
  }

  // Check meta-prompt attacks first — if the user is trying to jailbreak us,
  // we short-circuit before the content filter runs.
  for (const pattern of META_ATTACK_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        allow: false,
        category: 'unknown',
        matchedKeywords: [],
        rejectReason: 'meta_prompt_attack',
        suggestedResponse:
          'I\'m here to coach your training. Ask me about your workout, form, or recovery.',
      };
    }
  }

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        allow: false,
        category: 'unknown',
        matchedKeywords: [],
        rejectReason: 'unsafe',
        suggestedResponse:
          'I can\'t help with that topic. For safe training guidance, ask about workouts, form, nutrition, or recovery.',
      };
    }
  }

  const matches: Array<{ category: Exclude<RequestCategory, 'unknown'>; keyword: string }> = [];
  for (const [category, vocab] of Object.entries(CATEGORY_VOCAB) as Array<
    [Exclude<RequestCategory, 'unknown'>, readonly string[]]
  >) {
    for (const keyword of vocab) {
      if (matchesAsWord(prompt, keyword)) {
        matches.push({ category, keyword });
      }
    }
  }

  if (matches.length === 0) {
    // Check obvious off-topic hints before falling back to 'unknown'.
    for (const hint of OFF_TOPIC_HINTS) {
      if (matchesAsWord(prompt, hint)) {
        return {
          allow: false,
          category: 'unknown',
          matchedKeywords: [],
          rejectReason: 'off_topic',
          suggestedResponse:
            'That\'s outside what I help with. Ask me about your training, form, nutrition, or recovery.',
        };
      }
    }

    return {
      allow: false,
      category: 'unknown',
      matchedKeywords: [],
      rejectReason: 'off_topic',
      suggestedResponse:
        'I didn\'t catch a training topic there. Ask about your workout, a specific lift\'s form, macros, or recovery.',
    };
  }

  // Pick the category with the most matches. Ties broken by CATEGORY_PRIORITY.
  const counts: Partial<Record<Exclude<RequestCategory, 'unknown'>, number>> = {};
  for (const { category } of matches) {
    counts[category] = (counts[category] ?? 0) + 1;
  }
  const maxCount = Math.max(...Object.values(counts).filter((v): v is number => v != null));
  let winner: Exclude<RequestCategory, 'unknown'> | null = null;
  for (const category of CATEGORY_PRIORITY) {
    if ((counts[category] ?? 0) === maxCount) {
      winner = category;
      break;
    }
  }

  return {
    allow: true,
    category: winner ?? matches[0].category,
    matchedKeywords: Array.from(new Set(matches.map((m) => m.keyword))),
  };
}

function matchesAsWord(prompt: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Use manual boundaries instead of \b because \b considers punctuation
  // like "?" as a word boundary, which is what we want, but also requires
  // alphanumerics on both sides of word-internal matches — `\b` works fine
  // for our vocabulary since all keywords are alphanumeric-bounded.
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  return pattern.test(prompt);
}
