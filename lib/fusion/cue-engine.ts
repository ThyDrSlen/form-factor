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
  /** Lower numbers are higher priority. Priority 1 beats priority 3. */
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

/**
 * Audio handle the cue engine uses to cancel an in-flight cue when a
 * higher-priority one fires. In production this is
 * {@link AudioSessionManager}; tests can pass a plain object with jest mocks.
 */
export interface CueAudioController {
  cancel: () => void;
}

/**
 * Telemetry event emitted when the engine preempts a currently playing
 * lower-priority cue for a higher-priority one.
 */
export interface CueCancellationResult {
  timestampMs: number;
  cancelledRuleId: string;
  cancelledPriority: number;
  replacedByRuleId: string;
  replacedByPriority: number;
}

export interface CueEngineOptions {
  minConfidence: number;
  /** Optional audio controller used to interrupt mid-utterance playback. */
  audio?: CueAudioController;
  /**
   * Called when a lower-priority cue is interrupted by a higher-priority one.
   * Kept synchronous and side-effect-free at the engine boundary — consumers
   * can forward to supabase / console / analytics as they see fit.
   */
  onCancellation?: (event: CueCancellationResult) => void;
  /**
   * Estimated time it takes a cue to play out. The engine assumes a cue is
   * still "playing" for this many ms after its emission when deciding whether
   * to preempt. Defaults to 1500ms which matches a typical ElevenLabs Flash
   * short phrase. Callers with better knowledge (e.g. actual TTS duration)
   * can lower it.
   */
  estimatedPlaybackMs?: number;
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

interface PlayingCueState {
  ruleId: string;
  priority: number;
  startedAtMs: number;
}

export interface CueEngine {
  evaluate(input: CueEvaluationInput): CueEmission[];
}

const DEFAULT_ESTIMATED_PLAYBACK_MS = 1500;

class DefaultCueEngine implements CueEngine {
  private readonly runtime = new Map<string, RuleRuntimeState>();
  private currentlyPlaying: PlayingCueState | null = null;

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
    const selected = emissions[0];
    if (!selected) {
      return [];
    }

    this.maybeCancelLowerPriority(selected, input.timestampMs);
    this.currentlyPlaying = {
      ruleId: selected.ruleId,
      priority: selected.priority,
      startedAtMs: input.timestampMs,
    };

    return [selected];
  }

  /**
   * If a lower-priority cue is mid-playback, interrupt it so the incoming
   * higher-priority cue can be heard immediately. Equal-priority cues do NOT
   * cancel — we let the current one finish to avoid stutter when two equally
   * important rules fire back-to-back.
   */
  private maybeCancelLowerPriority(incoming: CueEmission, nowMs: number): void {
    const playing = this.currentlyPlaying;
    if (!playing) {
      return;
    }

    const playbackMs = this.options.estimatedPlaybackMs ?? DEFAULT_ESTIMATED_PLAYBACK_MS;
    const elapsed = nowMs - playing.startedAtMs;
    if (elapsed >= playbackMs) {
      // Previous cue has almost certainly finished already — nothing to cancel.
      this.currentlyPlaying = null;
      return;
    }

    // Lower priority number = more urgent. Only preempt when strictly higher.
    if (incoming.priority >= playing.priority) {
      return;
    }

    this.options.audio?.cancel();
    this.options.onCancellation?.({
      timestampMs: nowMs,
      cancelledRuleId: playing.ruleId,
      cancelledPriority: playing.priority,
      replacedByRuleId: incoming.ruleId,
      replacedByPriority: incoming.priority,
    });
  }
}

export function createCueEngine(rules: CueRule[], options: CueEngineOptions): CueEngine {
  return new DefaultCueEngine(rules, options);
}
