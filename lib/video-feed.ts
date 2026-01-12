import { BENCHPRESS_THRESHOLDS, PULLUP_THRESHOLDS, PUSHUP_THRESHOLDS } from '@/lib/workouts';

type Mode = 'benchpress' | 'pullup' | 'pushup';

export type VideoFeedMetrics = {
  mode?: Mode;
  reps?: number;
  avgElbowDeg?: number | null;
  avgElbow?: number | null;
  avgShoulderDeg?: number | null;
  avgShoulder?: number | null;
  headToHand?: number | null;
  hipDropRatio?: number | null;
  hipDrop?: number | null;
  formScore?: number | null;
  fqi?: number | null;
  avgFqi?: number | null;
  tempo?: string | number | null;
  depth?: string | number | null;
  range?: string | number | null;
  [key: string]: any;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toNumber = (value: unknown): number | null => {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const resolveMode = (exercise?: string | null, metrics?: VideoFeedMetrics | null): Mode | null => {
  if (metrics?.mode === 'benchpress' || metrics?.mode === 'pullup' || metrics?.mode === 'pushup') {
    return metrics.mode;
  }
  if (!exercise) return null;
  const normalized = exercise.toLowerCase();
  if (normalized.includes('bench')) return 'benchpress';
  if (normalized.includes('pull')) return 'pullup';
  if (normalized.includes('push')) return 'pushup';
  return null;
};

const normalizeScore = (value: number) => clamp(Math.round(value), 0, 100);

export const buildMetricBadges = (
  metrics?: VideoFeedMetrics | null
): string[] => {
  const badges: string[] = [];
  if (metrics?.tempo) badges.push(`Tempo ${metrics.tempo}`);
  if (metrics?.depth) badges.push(`Depth ${metrics.depth}`);
  if (metrics?.range) badges.push(`ROM ${metrics.range}`);
  return badges;
};

export const buildVideoSummary = (
  metrics?: VideoFeedMetrics | null,
  durationSeconds?: number | null
): string => {
  if (metrics?.reps) return `${metrics.reps} reps`;
  if (durationSeconds) return `${Math.round(durationSeconds)}s`;
  return 'Workout set';
};

export const formatVideoTimestamp = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const dateLabel = isToday
    ? 'Today'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateLabel}, ${timeLabel}`;
};

export const formatRelativeTime = (createdAt: string): string => {
  const date = new Date(createdAt);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const getFormLabel = (score: number | null): string | null => {
  if (score === null) return null;
  if (score >= 85) return 'Clean';
  if (score >= 70) return 'Solid';
  if (score >= 50) return 'Getting there';
  return 'Needs work';
};

export const buildOverlaySummary = (
  metrics?: VideoFeedMetrics | null,
  durationSeconds?: number | null,
  formScore?: number | null
): string => {
  if (metrics?.reps) {
    const label = getFormLabel(formScore ?? null);
    return label ? `${metrics.reps} reps • ${label}` : `${metrics.reps} reps`;
  }
  if (durationSeconds) return `${Math.round(durationSeconds)}s`;
  return 'Workout set';
};

export const buildPostText = (
  metrics?: VideoFeedMetrics | null,
  exercise?: string | null
): string => {
  const reps = metrics?.reps;
  if (reps && exercise) {
    const lower = exercise.toLowerCase();
    const normalized = lower.includes('workout') || lower.includes('share') ? 'rep' : lower;
    const plural = reps === 1 ? normalized : `${normalized}s`;
    return `Finally hit ${reps} ${plural}!`;
  }
  if (exercise) return `Shared a ${exercise} set.`;
  return 'Shared a new set.';
};

export const getFormScore = (
  metrics?: VideoFeedMetrics | null,
  exercise?: string | null
): number | null => {
  if (!metrics) return null;

  const explicitScore =
    toNumber(metrics.formScore) ?? toNumber(metrics.fqi) ?? toNumber(metrics.avgFqi);
  if (explicitScore !== null) {
    return normalizeScore(explicitScore);
  }

  const mode = resolveMode(exercise, metrics);
  if (!mode) return null;

  if (mode === 'pullup') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const shoulder = toNumber(metrics.avgShoulderDeg ?? metrics.avgShoulder);
    if (elbow === null && shoulder === null) return null;

    const elbowScore = elbow === null
      ? null
      : normalizeScore(
          clamp(
            1 - (elbow - PULLUP_THRESHOLDS.top) / (PULLUP_THRESHOLDS.hang - PULLUP_THRESHOLDS.top),
            0,
            1
          ) * 100
        );

    const shoulderScore = shoulder === null
      ? null
      : normalizeScore(
          shoulder <= PULLUP_THRESHOLDS.shoulderElevation
            ? 100
            : 100 - (shoulder - PULLUP_THRESHOLDS.shoulderElevation) * 2
        );

    const elbowWeight = elbowScore === null ? 0 : 0.7;
    const shoulderWeight = shoulderScore === null ? 0 : 0.3;
    const totalWeight = elbowWeight + shoulderWeight || 1;
    const weighted = (elbowScore ?? 0) * elbowWeight + (shoulderScore ?? 0) * shoulderWeight;
    return normalizeScore(weighted / totalWeight);
  }

  if (mode === 'pushup') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const hipDrop = toNumber(metrics.hipDropRatio ?? metrics.hipDrop);
    if (elbow === null && hipDrop === null) return null;

    const elbowScore = elbow === null
      ? null
      : normalizeScore(
          clamp(
            1 - (elbow - PUSHUP_THRESHOLDS.bottom) / (PUSHUP_THRESHOLDS.readyElbow - PUSHUP_THRESHOLDS.bottom),
            0,
            1
          ) * 100
        );

    const hipScore = hipDrop === null
      ? null
      : normalizeScore(
          hipDrop <= PUSHUP_THRESHOLDS.hipSagMax
            ? 100
            : clamp(1 - (hipDrop - PUSHUP_THRESHOLDS.hipSagMax) / PUSHUP_THRESHOLDS.hipSagMax, 0, 1) * 100
        );

    const elbowWeight = elbowScore === null ? 0 : 0.7;
    const hipWeight = hipScore === null ? 0 : 0.3;
    const totalWeight = elbowWeight + hipWeight || 1;
    const weighted = (elbowScore ?? 0) * elbowWeight + (hipScore ?? 0) * hipWeight;
    return normalizeScore(weighted / totalWeight);
  }

  if (mode === 'benchpress') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const shoulder = toNumber(metrics.avgShoulderDeg ?? metrics.avgShoulder);
    if (elbow === null && shoulder === null) return null;

    const elbowScore = elbow === null
      ? null
      : normalizeScore(
          clamp(
            1 - (elbow - BENCHPRESS_THRESHOLDS.bottom) / (BENCHPRESS_THRESHOLDS.readyElbow - BENCHPRESS_THRESHOLDS.bottom),
            0,
            1
          ) * 100
        );

    const shoulderScore = shoulder === null
      ? null
      : normalizeScore(
          shoulder <= BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax
            ? 100
            : 100 - (shoulder - BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax) * 2
        );

    const elbowWeight = elbowScore === null ? 0 : 0.7;
    const shoulderWeight = shoulderScore === null ? 0 : 0.3;
    const totalWeight = elbowWeight + shoulderWeight || 1;
    const weighted = (elbowScore ?? 0) * elbowWeight + (shoulderScore ?? 0) * shoulderWeight;
    return normalizeScore(weighted / totalWeight);
  }

  return null;
};

export const getPrimaryCue = (
  metrics?: VideoFeedMetrics | null,
  exercise?: string | null
): string | null => {
  if (!metrics) return null;
  const mode = resolveMode(exercise, metrics);
  if (!mode) return null;

  if (mode === 'pullup') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const shoulder = toNumber(metrics.avgShoulderDeg ?? metrics.avgShoulder);
    if (elbow === null && shoulder === null) return null;

    if (elbow !== null && elbow > PULLUP_THRESHOLDS.top + 15) {
      return 'Pull higher to bring your chin past the bar.';
    }
    if (elbow !== null && elbow < PULLUP_THRESHOLDS.hang - 5) {
      return 'Fully extend your arms before the next rep.';
    }
    if (shoulder !== null && shoulder > PULLUP_THRESHOLDS.shoulderElevation) {
      return 'Draw your shoulders down to keep your lats engaged.';
    }
    return 'Strong reps - keep the descent smooth.';
  }

  if (mode === 'pushup') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const hipDrop = toNumber(metrics.hipDropRatio ?? metrics.hipDrop);
    if (elbow === null && hipDrop === null) return null;

    if (hipDrop !== null && hipDrop > PUSHUP_THRESHOLDS.hipSagMax) {
      return 'Squeeze glutes to stop hip sag.';
    }
    if (elbow !== null && elbow > PUSHUP_THRESHOLDS.bottom + 10) {
      return 'Lower deeper until elbows hit ~90°.';
    }
    if (elbow !== null && elbow < PUSHUP_THRESHOLDS.readyElbow - 5) {
      return 'Start from a full lockout to count clean reps.';
    }
    return 'Smooth tempo - steady down, strong press up.';
  }

  if (mode === 'benchpress') {
    const elbow = toNumber(metrics.avgElbowDeg ?? metrics.avgElbow);
    const shoulder = toNumber(metrics.avgShoulderDeg ?? metrics.avgShoulder);
    if (elbow === null && shoulder === null) return null;

    if (shoulder !== null && shoulder > BENCHPRESS_THRESHOLDS.elbowFlareShoulderMax) {
      return 'Tuck elbows slightly to protect your shoulders.';
    }
    if (elbow !== null && elbow > BENCHPRESS_THRESHOLDS.bottom + 10) {
      return 'Lower the bar closer to your chest for full range.';
    }
    if (elbow !== null && elbow < BENCHPRESS_THRESHOLDS.readyElbow - 5) {
      return 'Finish each rep with a full lockout.';
    }
    return 'Smooth tempo - steady down, strong press up.';
  }

  return null;
};
