import type { Phase } from '@/lib/fusion/contracts';

export type CueChannel = 'speech' | 'watch_haptic' | 'ui';

export interface CueRule {
  id: string;
  metric: string;
  phases: Phase[];
  min: number;
  max: number;
  persistMs: number;
  cooldownMs: number;
  priority: number;
  /**
   * Primary cue text. Used when `messageVariants` is absent or empty.
   * Kept as the required field so existing rules authored before the
   * variant rotation landed continue to work unchanged.
   */
  message: string;
  /**
   * Optional rotation set. When present, the engine cycles through these
   * strings in order across repeated emissions of this rule — first
   * emission uses index 0, next uses index 1, wrapping at the end. This
   * breaks the "same phrasing 5 times in a session" retention tax
   * without any LLM involvement.
   */
  messageVariants?: string[];
  channels?: CueChannel[];
}

export interface CueEngineOptions {
  minConfidence: number;
}

export interface CueEvaluationInput {
  timestampMs: number;
  phase: Phase;
  confidence: number;
  metrics: Record<string, number>;
}

export interface CueEmission {
  ruleId: string;
  message: string;
  priority: number;
  delta: number;
  channels: CueChannel[];
}

interface RuleRuntimeState {
  violationSinceMs: number | null;
  lastEmitMs: number | null;
  /** Index into `messageVariants`. Ignored when no variants are set. */
  variantIndex: number;
}

function pickCueMessage(rule: CueRule, runtimeState: RuleRuntimeState): string {
  const variants = rule.messageVariants;
  if (!variants || variants.length === 0) return rule.message;
  const idx = runtimeState.variantIndex % variants.length;
  const picked = variants[idx] ?? rule.message;
  runtimeState.variantIndex = (runtimeState.variantIndex + 1) % variants.length;
  return picked;
}

export interface CueEngine {
  evaluate(input: CueEvaluationInput): CueEmission[];
}

class DefaultCueEngine implements CueEngine {
  private readonly runtime = new Map<string, RuleRuntimeState>();

  constructor(private readonly rules: CueRule[], private readonly options: CueEngineOptions) {
    for (const rule of rules) {
      this.runtime.set(rule.id, { violationSinceMs: null, lastEmitMs: null, variantIndex: 0 });
    }
  }

  evaluate(input: CueEvaluationInput): CueEmission[] {
    if (input.confidence < this.options.minConfidence) {
      return [];
    }

    const emissions: CueEmission[] = [];

    for (const rule of this.rules) {
      if (!rule.phases.includes(input.phase)) {
        this.runtime.get(rule.id)!.violationSinceMs = null;
        continue;
      }

      const value = input.metrics[rule.metric];
      if (!Number.isFinite(value)) {
        this.runtime.get(rule.id)!.violationSinceMs = null;
        continue;
      }

      const deltaLow = rule.min - value;
      const deltaHigh = value - rule.max;
      const violated = deltaLow > 0 || deltaHigh > 0;
      const runtimeState = this.runtime.get(rule.id)!;

      if (!violated) {
        runtimeState.violationSinceMs = null;
        continue;
      }

      if (runtimeState.violationSinceMs === null) {
        runtimeState.violationSinceMs = input.timestampMs;
      }

      const persistedFor = input.timestampMs - runtimeState.violationSinceMs;
      if (persistedFor < rule.persistMs) {
        continue;
      }

      if (runtimeState.lastEmitMs !== null && input.timestampMs - runtimeState.lastEmitMs < rule.cooldownMs) {
        continue;
      }

      runtimeState.lastEmitMs = input.timestampMs;
      emissions.push({
        ruleId: rule.id,
        message: pickCueMessage(rule, runtimeState),
        priority: rule.priority,
        delta: Math.max(deltaLow, deltaHigh, 0),
        channels: rule.channels ?? ['speech'],
      });
    }

    emissions.sort((a, b) => a.priority - b.priority || b.delta - a.delta);
    return emissions.slice(0, 1);
  }
}

export function createCueEngine(rules: CueRule[], options: CueEngineOptions): CueEngine {
  return new DefaultCueEngine(rules, options);
}
