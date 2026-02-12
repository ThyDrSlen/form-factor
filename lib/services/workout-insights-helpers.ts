export type PoseRow = {
  frame_timestamp: number;
  rep_number: number | null;
  phase?: string | null;
  left_elbow_deg: number | null;
  right_elbow_deg: number | null;
  left_shoulder_deg: number | null;
  right_shoulder_deg: number | null;
  left_knee_deg: number | null;
  right_knee_deg: number | null;
  left_hip_deg: number | null;
  right_hip_deg: number | null;
};

export type JointPair = {
  key: 'elbow' | 'shoulder' | 'knee' | 'hip';
  left: keyof PoseRow;
  right: keyof PoseRow;
  label: string;
};

export interface WavePoint {
  index: number;
  left: number;
  right: number;
  repNumber: number | null;
  phase: string | null;
}

export type FatigueLevel = 'low' | 'moderate' | 'high' | null;

export interface FatigueSignals {
  fqiDropPct: number | null;
  tempoDriftPct: number | null;
  asymmetryDriftDeg: number | null;
  heartRateBpm: number | null;
  heartRateBaselineBpm: number | null;
  heartRateStrainBpm: number | null;
}

export interface CoachAction {
  id: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export type FatigueConfidenceLevel = 'high' | 'medium' | 'low' | 'insufficient';

export interface FatigueConfidence {
  score: number | null;
  level: FatigueConfidenceLevel;
  note: string;
}

const JOINT_PAIRS: JointPair[] = [
  { key: 'elbow', left: 'left_elbow_deg', right: 'right_elbow_deg', label: 'Elbow Angle' },
  { key: 'shoulder', left: 'left_shoulder_deg', right: 'right_shoulder_deg', label: 'Shoulder Angle' },
  { key: 'knee', left: 'left_knee_deg', right: 'right_knee_deg', label: 'Knee Angle' },
  { key: 'hip', left: 'left_hip_deg', right: 'right_hip_deg', label: 'Hip Angle' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function selectBestJointPair(rows: PoseRow[]): JointPair {
  let bestPair = JOINT_PAIRS[0];
  let bestScore = -1;

  for (const pair of JOINT_PAIRS) {
    const bothTracked = rows.filter((row) => Number.isFinite(row[pair.left]) && Number.isFinite(row[pair.right]));
    if (bothTracked.length === 0) continue;

    const diffs = bothTracked.map((row) => Math.abs((row[pair.left] as number) - (row[pair.right] as number)));
    const amplitude = bothTracked.map((row) => Math.abs((row[pair.left] as number) - mean([(row[pair.left] as number), (row[pair.right] as number)])));
    const score = bothTracked.length * 0.85 + mean(amplitude) * 0.15 - mean(diffs) * 0.02;
    if (score > bestScore) {
      bestScore = score;
      bestPair = pair;
    }
  }

  return bestPair;
}

export function buildWavePoints(rows: PoseRow[], pair: JointPair, maxPoints = 80): WavePoint[] {
  if (rows.length === 0) return [];
  const bucketSize = Math.max(1, Math.ceil(rows.length / Math.max(1, maxPoints)));
  const points: WavePoint[] = [];

  for (let i = 0; i < rows.length; i += bucketSize) {
    const chunk = rows.slice(i, i + bucketSize);
    const leftValues = chunk.map((row) => row[pair.left]).filter((value): value is number => typeof value === 'number');
    const rightValues = chunk.map((row) => row[pair.right]).filter((value): value is number => typeof value === 'number');
    if (leftValues.length === 0 || rightValues.length === 0) continue;

    const repValues = chunk.map((row) => row.rep_number).filter((value): value is number => typeof value === 'number');
    const phases = chunk
      .map((row) => row.phase?.trim().toLowerCase())
      .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0);

    let dominantPhase: string | null = null;
    if (phases.length > 0) {
      const counts = new Map<string, number>();
      for (const phase of phases) {
        counts.set(phase, (counts.get(phase) ?? 0) + 1);
      }
      dominantPhase = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    points.push({
      index: points.length,
      left: Number(mean(leftValues).toFixed(2)),
      right: Number(mean(rightValues).toFixed(2)),
      repNumber: repValues.length > 0 ? Math.round(mean(repValues)) : null,
      phase: dominantPhase,
    });
  }

  return points;
}

export function computeAsymmetry(wavePoints: WavePoint[]): {
  meanAsymmetryDeg: number;
  p95AsymmetryDeg: number;
  maxAsymmetryDeg: number;
  asymmetryScore: number;
} {
  const deltas = wavePoints.map((point) => Math.abs(point.left - point.right));
  const meanAsymmetryDeg = mean(deltas);
  const p95AsymmetryDeg = percentile(deltas, 95);
  const maxAsymmetryDeg = deltas.length > 0 ? Math.max(...deltas) : 0;
  const asymmetryScore = clamp(100 - meanAsymmetryDeg * 2.4 - p95AsymmetryDeg * 0.8, 0, 100);
  return {
    meanAsymmetryDeg: Number(meanAsymmetryDeg.toFixed(2)),
    p95AsymmetryDeg: Number(p95AsymmetryDeg.toFixed(2)),
    maxAsymmetryDeg: Number(maxAsymmetryDeg.toFixed(2)),
    asymmetryScore: Math.round(asymmetryScore),
  };
}

export function meanValue(values: number[]): number {
  return mean(values);
}

export function clampValue(value: number, min: number, max: number): number {
  return clamp(value, min, max);
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

export function scoreFatigueSignals(signals: FatigueSignals): {
  fatigueScore: number | null;
  fatigueLevel: FatigueLevel;
} {
  const components: number[] = [];

  if (typeof signals.fqiDropPct === 'number') {
    components.push(clamp(Math.max(0, signals.fqiDropPct) * 1.1, 0, 30));
  }

  if (typeof signals.tempoDriftPct === 'number') {
    components.push(clamp(Math.max(0, signals.tempoDriftPct) * 0.9, 0, 25));
  }

  if (typeof signals.asymmetryDriftDeg === 'number') {
    components.push(clamp(Math.max(0, signals.asymmetryDriftDeg) * 2.2, 0, 25));
  }

  if (typeof signals.heartRateStrainBpm === 'number') {
    components.push(clamp(Math.max(0, signals.heartRateStrainBpm - 2) * 1.8, 0, 20));
  }

  if (components.length === 0) {
    return {
      fatigueScore: null,
      fatigueLevel: null,
    };
  }

  const fatigueScore = Math.round(clamp(components.reduce((sum, value) => sum + value, 0), 0, 100));
  const fatigueLevel: FatigueLevel =
    fatigueScore <= 30 ? 'low' : fatigueScore <= 60 ? 'moderate' : 'high';

  return {
    fatigueScore,
    fatigueLevel,
  };
}

export function buildCoachActions(input: {
  fatigueLevel: FatigueLevel;
  signals: FatigueSignals;
}): CoachAction[] {
  const actions: CoachAction[] = [];

  if (input.fatigueLevel === 'high') {
    actions.push({
      id: 'reduce-load',
      title: 'Reduce working load 5-10%',
      detail: 'High fatigue trend detected. Keep quality high and avoid form collapse.',
      priority: 'high',
    });
    actions.push({
      id: 'extend-rest',
      title: 'Extend rest windows by 60-90s',
      detail: 'Extra recovery between sets should improve movement consistency.',
      priority: 'high',
    });
  }

  if (typeof input.signals.tempoDriftPct === 'number' && input.signals.tempoDriftPct >= 12) {
    actions.push({
      id: 'tempo-reset',
      title: 'Tempo reset set',
      detail: 'Do one lighter control set with strict cadence before adding intensity.',
      priority: input.signals.tempoDriftPct >= 18 ? 'high' : 'medium',
    });
  }

  if (typeof input.signals.asymmetryDriftDeg === 'number' && input.signals.asymmetryDriftDeg >= 3.5) {
    actions.push({
      id: 'symmetry-block',
      title: 'Add unilateral balance block',
      detail: 'Asymmetry increased. Add single-side tempo work for the weaker side.',
      priority: input.signals.asymmetryDriftDeg >= 6 ? 'high' : 'medium',
    });
  }

  if (typeof input.signals.heartRateStrainBpm === 'number' && input.signals.heartRateStrainBpm >= 8) {
    actions.push({
      id: 'cardio-recovery',
      title: 'Lower set density today',
      detail: 'Heart-rate strain is elevated versus baseline; reduce cluster density or add cooldown.',
      priority: input.signals.heartRateStrainBpm >= 12 ? 'high' : 'medium',
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'progressive-overload',
      title: 'Progress with small overload',
      detail: 'Fatigue signals are stable. Consider +2.5% load or one extra quality rep next set.',
      priority: 'low',
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
  return [...actions]
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 3);
}

export function scoreFatigueConfidence(input: {
  repsCount: number;
  poseFrameCount: number;
  trendPointCount: number;
  hasFqiDrop: boolean;
  hasTempoDrift: boolean;
  hasAsymmetryDrift: boolean;
  hasHeartRate: boolean;
  hasHeartRateBaseline: boolean;
  trackingConfidence: number | null;
}): FatigueConfidence {
  const repsScore =
    input.repsCount >= 8 ? 25 : input.repsCount >= 4 ? 18 : input.repsCount >= 2 ? 10 : 0;
  const framesScore =
    input.poseFrameCount >= 600 ? 20 : input.poseFrameCount >= 200 ? 14 : input.poseFrameCount >= 80 ? 8 : 0;
  const trendScore = input.trendPointCount >= 4 ? 10 : input.trendPointCount >= 2 ? 5 : 0;

  let score = repsScore + framesScore + trendScore;
  if (input.hasFqiDrop) score += 15;
  if (input.hasTempoDrift) score += 15;
  if (input.hasAsymmetryDrift) score += 10;
  if (input.hasHeartRate) score += 8;
  if (input.hasHeartRateBaseline) score += 7;
  if (typeof input.trackingConfidence === 'number') {
    score += input.trackingConfidence >= 0.85 ? 10 : input.trackingConfidence >= 0.72 ? 6 : 3;
  }

  if (score <= 0) {
    return {
      score: null,
      level: 'insufficient',
      note: 'Need at least one completed set to estimate fatigue confidence.',
    };
  }

  const bounded = Math.round(clamp(score, 0, 100));
  const level: FatigueConfidenceLevel =
    bounded >= 75 ? 'high' : bounded >= 55 ? 'medium' : bounded >= 35 ? 'low' : 'insufficient';

  if (level === 'high') {
    return { score: bounded, level, note: 'Confidence is high across movement and heart-rate signals.' };
  }

  const missing: string[] = [];
  if (!input.hasHeartRateBaseline) missing.push('heart-rate baseline');
  if (typeof input.trackingConfidence !== 'number' || input.trackingConfidence < 0.72) missing.push('stable tracking confidence');
  if (!input.hasAsymmetryDrift) missing.push('asymmetry drift');
  if (!input.hasFqiDrop) missing.push('rep quality drift');
  if (!input.hasTempoDrift) missing.push('tempo drift');

  if (missing.length === 0) {
    return { score: bounded, level, note: 'Signal quality is improving; gather more sessions for stronger confidence.' };
  }

  return {
    score: bounded,
    level,
    note: `Confidence limited by missing ${missing.slice(0, 2).join(' and ')}.`,
  };
}
