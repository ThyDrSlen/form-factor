/** Admission policy for the existing premium cue player, not another audio pipeline. */
export const EXERCISE_CUE_POLICY = {
  // Conservative UX thresholds, not clinically validated injury predictions.
  sustainMs: 1500,
  maxSampleGapMs: 750,
  minConfidence: 0.8,
  cooldownMs: 8000,
  correctionMs: 2500,
} as const;

export interface ExerciseAudioCue {
  issueId: string;
  message: string;
  /** Lower numbers have higher priority, matching the fusion cue engine. */
  priority: 1 | 2 | 3;
  kind: 'form' | 'visibility';
}

export interface ExerciseAudioObservation {
  /** Session + exercise, never rep number or movement phase. */
  contextKey: string;
  /** ID of the RAW tracking sample, not a held display pose or render counter. */
  sampleId: string | number;
  trackingConfidence: number | null;
  /** Omit only when the source genuinely has no phase information. */
  atRepBoundary?: boolean;
  /** Current actionable problems only. Never static phase prompts or praise. */
  candidates: readonly ExerciseAudioCue[];
  /** Explicitly evaluated corrections. Absence in another phase is not correction. */
  resolvedIssueIds?: readonly string[];
}

export class ExerciseCuePolicy {
  private lastSample: string | number | null = null;
  private context: string | null = null;
  private since = new Map<string, number>();
  private lastObservationAt: number | null = null;
  private spoken = new Set<string>();
  private correctedSince = new Map<string, number>();
  private lastSpokenAt = -Infinity;
  private eligible: ExerciseAudioCue[] = [];
  private atRepBoundary: boolean | undefined;

  /** Current evidence lease, independent of selection cooldown/deduplication. */
  validUntil(cue: ExerciseAudioCue, contextKey: string, now: number, starting = false): number | null {
    if (contextKey !== this.context || this.lastObservationAt === null || now < this.lastObservationAt) return null;
    const expiresAt = this.lastObservationAt + EXERCISE_CUE_POLICY.maxSampleGapMs;
    if (now > expiresAt || !this.eligible.some((current) =>
      current.issueId === cue.issueId && current.kind === cue.kind && current.message === cue.message
    )) return null;
    if (starting && cue.kind === 'form' && cue.priority !== 1 && this.atRepBoundary === false) return null;
    return expiresAt;
  }

  /** Call only after the existing player admits this cue, never on selection alone. */
  markSpoken(cue: ExerciseAudioCue, now: number): void {
    this.spoken.add(cue.issueId);
    this.lastSpokenAt = now;
  }

  reset(): void {
    this.lastSample = null;
    this.context = null;
    this.since.clear();
    this.lastObservationAt = null;
    this.spoken.clear();
    this.correctedSince.clear();
    this.eligible = [];
    this.atRepBoundary = undefined;
  }

  observe(input: ExerciseAudioObservation, now: number): ExerciseAudioCue | null {
    if (input.contextKey !== this.context) {
      this.reset();
      this.context = input.contextKey;
    }
    if (input.sampleId === this.lastSample) return null;
    this.lastSample = input.sampleId;
    if (this.lastObservationAt !== null && (now - this.lastObservationAt > EXERCISE_CUE_POLICY.maxSampleGapMs || now < this.lastObservationAt)) {
      this.since.clear();
      this.correctedSince.clear();
    }
    this.lastObservationAt = now;
    const reliable = input.trackingConfidence !== null && Number.isFinite(input.trackingConfidence) &&
      input.trackingConfidence >= EXERCISE_CUE_POLICY.minConfidence && input.trackingConfidence <= 1;
    const eligible = input.candidates.filter((cue) => cue.message.trim() && (cue.kind === 'visibility' || reliable));
    this.eligible = eligible.map((cue) => ({ ...cue }));
    this.atRepBoundary = input.atRepBoundary;
    for (const key of this.spoken) {
      // Loss of tracking is unknown, never evidence that form was corrected.
      if (!reliable || !input.resolvedIssueIds?.includes(key) || input.candidates.some((cue) => cue.issueId === key)) {
        this.correctedSince.delete(key);
      } else {
        if (!this.correctedSince.has(key)) this.correctedSince.set(key, now);
        if (now - this.correctedSince.get(key)! >= EXERCISE_CUE_POLICY.correctionMs) {
          this.spoken.delete(key);
          this.correctedSince.delete(key);
        }
      }
    }
    for (const key of this.since.keys()) {
      if (!eligible.some((cue) => cue.issueId === key)) this.since.delete(key);
    }
    for (const cue of eligible) {
      if (!this.since.has(cue.issueId)) this.since.set(cue.issueId, now);
    }
    const selected = eligible.sort((a, b) => a.priority - b.priority || a.issueId.localeCompare(b.issueId))[0];
    if (!selected || now - this.since.get(selected.issueId)! < EXERCISE_CUE_POLICY.sustainMs) return null;
    if (this.spoken.has(selected.issueId) || now - this.lastSpokenAt < EXERCISE_CUE_POLICY.cooldownMs) return null;
    if (selected.kind === 'form' && selected.priority !== 1 && input.atRepBoundary === false) return null;
    return selected;
  }
}
