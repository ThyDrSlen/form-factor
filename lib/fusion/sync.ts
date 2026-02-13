export type SensorPresence = {
  camera: boolean;
  watch: boolean;
  airpods: boolean;
};

export type FusionMode = 'full' | 'degraded' | 'unsupported';

export type AlignmentReason = 'aligned' | 'missing_secondary' | 'stale_frame';

export interface AlignmentResult {
  accepted: boolean;
  reason: AlignmentReason;
  skewSec: number;
}

export interface SensorClassification {
  key: string;
  mode: FusionMode;
  presence: SensorPresence;
}

export interface TimedSample<T> {
  timestampSec: number;
  value: T;
}

function enabledKey(presence: SensorPresence): string {
  const enabled: string[] = [];
  if (presence.camera) enabled.push('camera');
  if (presence.watch) enabled.push('watch');
  if (presence.airpods) enabled.push('airpods');
  return enabled.join('+');
}

export function selectAlignedSensorFrame(input: {
  primaryTimestampSec: number;
  secondaryTimestampSec?: number | null;
  maxTimestampSkewSec: number;
}): AlignmentResult {
  if (typeof input.secondaryTimestampSec !== 'number' || !Number.isFinite(input.secondaryTimestampSec)) {
    return {
      accepted: false,
      reason: 'missing_secondary',
      skewSec: Number.POSITIVE_INFINITY,
    };
  }

  const skewSec = Math.abs(input.primaryTimestampSec - input.secondaryTimestampSec);
  if (skewSec > input.maxTimestampSkewSec) {
    return {
      accepted: false,
      reason: 'stale_frame',
      skewSec,
    };
  }

  return {
    accepted: true,
    reason: 'aligned',
    skewSec,
  };
}

export function classifySensorAvailability(presence: SensorPresence): SensorClassification {
  const key = enabledKey(presence);

  if (!presence.camera) {
    return { key, mode: 'unsupported', presence };
  }

  if (presence.camera && presence.watch && presence.airpods) {
    return { key, mode: 'full', presence };
  }

  return { key, mode: 'degraded', presence };
}

export function buildNonEmptySensorMatrix(): Array<SensorClassification & { expectedMode: FusionMode }> {
  const matrix: Array<SensorClassification & { expectedMode: FusionMode }> = [];
  const values = [false, true] as const;

  for (const camera of values) {
    for (const watch of values) {
      for (const airpods of values) {
        if (!camera && !watch && !airpods) {
          continue;
        }

        const presence: SensorPresence = { camera, watch, airpods };
        const classification = classifySensorAvailability(presence);
        matrix.push({ ...classification, expectedMode: classification.mode });
      }
    }
  }

  return matrix;
}

export class TimedSensorBuffer<T> {
  private readonly capacity: number;
  private readonly samples: Array<TimedSample<T>> = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  push(sample: TimedSample<T>): void {
    this.samples.push(sample);
    this.samples.sort((a, b) => a.timestampSec - b.timestampSec);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
  }

  nearestAtOrBefore(timestampSec: number): TimedSample<T> | null {
    for (let i = this.samples.length - 1; i >= 0; i -= 1) {
      if (this.samples[i].timestampSec <= timestampSec) {
        return this.samples[i];
      }
    }
    return null;
  }
}
