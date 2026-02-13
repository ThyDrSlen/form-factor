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
  message: string;
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
}

export interface CueEngine {
  evaluate(input: CueEvaluationInput): CueEmission[];
}

class DefaultCueEngine implements CueEngine {
  private readonly runtime = new Map<string, RuleRuntimeState>();

  constructor(private readonly rules: CueRule[], private readonly options: CueEngineOptions) {
    for (const rule of rules) {
      this.runtime.set(rule.id, { violationSinceMs: null, lastEmitMs: null });
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
        message: rule.message,
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
