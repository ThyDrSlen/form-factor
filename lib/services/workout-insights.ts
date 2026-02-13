import { supabase } from '@/lib/supabase';
import {
  buildCoachActions,
  buildWavePoints,
  clampValue,
  computeAsymmetry,
  meanValue,
  scoreFatigueConfidence,
  scoreFatigueSignals,
  selectBestJointPair,
  stddev,
  type CoachAction,
  type FatigueConfidence,
  type FatigueLevel,
  type FatigueSignals,
  type JointPair,
  type PoseRow,
  type WavePoint,
} from '@/lib/services/workout-insights-helpers';

type RepsRow = {
  rep_index: number;
  fqi: number | null;
  start_ts: string;
  end_ts: string;
  faults_detected: string[] | null;
};

type RepsTrendRow = {
  session_id: string;
  rep_index: number;
  fqi: number | null;
  start_ts: string;
  end_ts: string;
};

type SessionMetricsRow = {
  session_id: string;
  start_at: string | null;
  end_at: string | null;
  created_at?: string | null;
  shadow_mean_abs_delta: number | null;
  shadow_coverage_ratio: number | null;
  avg_fps: number | null;
};

type HealthMetricRow = {
  summary_date: string;
  heart_rate_bpm: number | null;
};

export interface DriverCard {
  id: string;
  title: string;
  value: string;
  detail: string;
  severity: 'good' | 'watch' | 'risk';
}

export interface WorkoutInsightsSnapshot {
  sessionId: string;
  waveLabel: string;
  wavePoints: WavePoint[];
  meanAsymmetryDeg: number;
  p95AsymmetryDeg: number;
  maxAsymmetryDeg: number;
  asymmetryScore: number;
  repsCompleted: number;
  avgFqi: number | null;
  avgRepDurationMs: number | null;
  repTempoCv: number | null;
  trackingConfidence: number | null;
  fatigueScore: number | null;
  fatigueLevel: 'low' | 'moderate' | 'high' | null;
  fatigueSignals: {
    fqiDropPct: number | null;
    tempoDriftPct: number | null;
    asymmetryDriftDeg: number | null;
    heartRateBpm: number | null;
    heartRateBaselineBpm: number | null;
    heartRateStrainBpm: number | null;
  };
  fatigueConfidence: FatigueConfidence;
  fatigueTrend: FatigueTrendPoint[];
  coachActions: CoachAction[];
  drivers: DriverCard[];
}

export interface FatigueTrendPoint {
  sessionId: string;
  label: string;
  score: number;
  level: Exclude<FatigueLevel, null>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function resolveWindowMeans(values: number[]): { first: number | null; last: number | null } {
  if (values.length === 0) {
    return { first: null, last: null };
  }

  const windowSize = Math.max(1, Math.floor(values.length / 3));
  const first = meanValue(values.slice(0, windowSize));
  const last = meanValue(values.slice(values.length - windowSize));
  return { first, last };
}

function toIsoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateWindow(anchorIsoDate: string, lookbackDays: number): { from: string; to: string } {
  const anchor = new Date(`${anchorIsoDate}T00:00:00.000Z`);
  const fromDate = new Date(anchor);
  fromDate.setUTCDate(anchor.getUTCDate() - lookbackDays);
  return { from: toIsoDateKey(fromDate), to: anchorIsoDate };
}

function buildRepAsymmetrySeries(poseRows: PoseRow[], pair: JointPair): number[] {
  const byRep = new Map<number, number[]>();
  for (const row of poseRows) {
    const rep = row.rep_number;
    if (typeof rep !== 'number' || rep <= 0) continue;
    const left = row[pair.left];
    const right = row[pair.right];
    if (typeof left !== 'number' || typeof right !== 'number') continue;
    const current = byRep.get(rep) ?? [];
    current.push(Math.abs(left - right));
    byRep.set(rep, current);
  }

  return [...byRep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map((entry) => meanValue(entry[1]));
}

function isoDateFromTimestamp(input?: string | null): string | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildRepDriftSignals(repsRows: Array<Pick<RepsRow, 'start_ts' | 'end_ts' | 'fqi'>>): {
  fqiDropPct: number | null;
  tempoDriftPct: number | null;
} {
  const repDurations = repsRows
    .map((row) => new Date(row.end_ts).getTime() - new Date(row.start_ts).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);
  const fqiValues = repsRows
    .map((row) => row.fqi)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const durationWindow = resolveWindowMeans(repDurations);
  const fqiWindow = resolveWindowMeans(fqiValues);

  const tempoDriftPct =
    durationWindow.first && durationWindow.first > 0 && durationWindow.last !== null
      ? Number((((durationWindow.last - durationWindow.first) / durationWindow.first) * 100).toFixed(2))
      : null;

  const fqiDropPct =
    fqiWindow.first && fqiWindow.first > 0 && fqiWindow.last !== null
      ? Number((((fqiWindow.first - fqiWindow.last) / fqiWindow.first) * 100).toFixed(2))
      : null;

  return {
    fqiDropPct,
    tempoDriftPct,
  };
}

function buildAsymmetryDrift(poseRows: PoseRow[], pair: JointPair): number | null {
  const asymSeries = buildRepAsymmetrySeries(poseRows, pair);
  const asymWindow = resolveWindowMeans(asymSeries);
  if (asymWindow.first === null || asymWindow.last === null) return null;
  return Number((asymWindow.last - asymWindow.first).toFixed(2));
}

function buildFatigueSignals(input: {
  fqiDropPct: number | null;
  tempoDriftPct: number | null;
  asymmetryDriftDeg: number | null;
  heartRateBpm: number | null;
  heartRateBaselineBpm: number | null;
}): FatigueSignals {
  const heartRateStrainBpm =
    input.heartRateBpm !== null && input.heartRateBaselineBpm !== null
      ? Number((input.heartRateBpm - input.heartRateBaselineBpm).toFixed(2))
      : null;

  return {
    fqiDropPct: input.fqiDropPct,
    tempoDriftPct: input.tempoDriftPct,
    asymmetryDriftDeg: input.asymmetryDriftDeg,
    heartRateBpm: input.heartRateBpm,
    heartRateBaselineBpm: input.heartRateBaselineBpm,
    heartRateStrainBpm,
  };
}

function resolveHeartRatesForDate(input: {
  sessionDate: string;
  heartRows: HealthMetricRow[];
}): {
  heartRateBpm: number | null;
  heartRateBaselineBpm: number | null;
} {
  const sessionDayHeart = input.heartRows.find((row) => row.summary_date === input.sessionDate)?.heart_rate_bpm ?? null;
  const baselineWindow = buildDateWindow(input.sessionDate, 7);
  const baselineHeart = median(
    input.heartRows
      .filter((row) => row.summary_date >= baselineWindow.from && row.summary_date < input.sessionDate)
      .map((row) => row.heart_rate_bpm)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );

  return {
    heartRateBpm: sessionDayHeart,
    heartRateBaselineBpm: baselineHeart === null ? null : Number(baselineHeart.toFixed(2)),
  };
}

function buildFatigueTrend(input: {
  sessions: SessionMetricsRow[];
  repsRows: RepsTrendRow[];
  heartRows: HealthMetricRow[];
}): FatigueTrendPoint[] {
  const repsBySession = new Map<string, RepsTrendRow[]>();
  for (const row of input.repsRows) {
    const existing = repsBySession.get(row.session_id) ?? [];
    existing.push(row);
    repsBySession.set(row.session_id, existing);
  }

  const trendPoints: FatigueTrendPoint[] = [];
  const orderedSessions = [...input.sessions].sort((a, b) => {
    const aDate = a.start_at ?? a.created_at ?? '';
    const bDate = b.start_at ?? b.created_at ?? '';
    return aDate.localeCompare(bDate);
  });

  for (const session of orderedSessions) {
    const reps = repsBySession.get(session.session_id) ?? [];
    if (reps.length < 2) continue;

    const repSignals = buildRepDriftSignals(reps);
    const sessionDate = isoDateFromTimestamp(session.start_at) ?? isoDateFromTimestamp(session.created_at) ?? null;
    if (!sessionDate) continue;
    const heartRates = resolveHeartRatesForDate({ sessionDate, heartRows: input.heartRows });
    const signals = buildFatigueSignals({
      ...repSignals,
      asymmetryDriftDeg: null,
      heartRateBpm: heartRates.heartRateBpm,
      heartRateBaselineBpm: heartRates.heartRateBaselineBpm,
    });
    const scored = scoreFatigueSignals(signals);
    if (scored.fatigueScore === null || scored.fatigueLevel === null) continue;

    trendPoints.push({
      sessionId: session.session_id,
      label: sessionDate.slice(5),
      score: scored.fatigueScore,
      level: scored.fatigueLevel,
    });
  }

  return trendPoints.slice(-8);
}

function buildDriverCards(input: {
  meanAsymmetryDeg: number;
  repTempoCv: number | null;
  trackingConfidence: number | null;
}): DriverCard[] {
  const asymmetrySeverity: DriverCard['severity'] =
    input.meanAsymmetryDeg <= 6 ? 'good' : input.meanAsymmetryDeg <= 12 ? 'watch' : 'risk';

  const tempoSeverity: DriverCard['severity'] =
    input.repTempoCv === null ? 'watch' : input.repTempoCv <= 0.12 ? 'good' : input.repTempoCv <= 0.2 ? 'watch' : 'risk';

  const confidenceSeverity: DriverCard['severity'] =
    input.trackingConfidence === null
      ? 'watch'
      : input.trackingConfidence >= 0.85
        ? 'good'
        : input.trackingConfidence >= 0.7
          ? 'watch'
          : 'risk';

  return [
    {
      id: 'asymmetry',
      title: 'Left/Right Balance',
      value: `${input.meanAsymmetryDeg.toFixed(1)} deg`,
      detail: 'Average left-right angle gap through the set.',
      severity: asymmetrySeverity,
    },
    {
      id: 'tempo',
      title: 'Rep Tempo Consistency',
      value: input.repTempoCv === null ? 'No rep data' : `${(input.repTempoCv * 100).toFixed(1)}% CV`,
      detail: 'Lower variation means smoother, repeatable biomechanics.',
      severity: tempoSeverity,
    },
    {
      id: 'confidence',
      title: 'Tracking Confidence',
      value: input.trackingConfidence === null ? '--' : `${Math.round(input.trackingConfidence * 100)}%`,
      detail: 'Built from shadow drift and shadow coverage quality.',
      severity: confidenceSeverity,
    },
  ];
}

function buildTempoStats(rows: RepsRow[]): { avgRepDurationMs: number | null; repTempoCv: number | null } {
  const durations = rows
    .map((row) => new Date(row.end_ts).getTime() - new Date(row.start_ts).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);

  if (durations.length === 0) {
    return { avgRepDurationMs: null, repTempoCv: null };
  }

  const avgRepDurationMs = Math.round(meanValue(durations));
  const spread = stddev(durations);
  const repTempoCv = avgRepDurationMs > 0 ? spread / avgRepDurationMs : null;

  return {
    avgRepDurationMs,
    repTempoCv: repTempoCv === null ? null : Number(repTempoCv.toFixed(4)),
  };
}

function computeTrackingConfidence(metrics: SessionMetricsRow | null): number | null {
  if (!metrics) return null;
  const drift = typeof metrics.shadow_mean_abs_delta === 'number' ? clampValue(1 - metrics.shadow_mean_abs_delta / 30, 0.1, 1) : null;
  const coverage = typeof metrics.shadow_coverage_ratio === 'number' ? clampValue(metrics.shadow_coverage_ratio, 0, 1) : null;
  if (drift === null && coverage === null) return null;
  if (drift !== null && coverage !== null) return Number((drift * 0.65 + coverage * 0.35).toFixed(4));
  return Number((drift ?? coverage ?? 0).toFixed(4));
}

async function resolveSessionId(inputSessionId?: string): Promise<string | null> {
  if (inputSessionId) return inputSessionId;
  const { data } = await supabase
    .from('session_metrics')
    .select('session_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.session_id ?? null;
}

export async function fetchWorkoutInsightsSnapshot(sessionId?: string): Promise<WorkoutInsightsSnapshot | null> {
  const resolvedSessionId = await resolveSessionId(sessionId);
  if (!resolvedSessionId) return null;

  const [{ data: metricsData }, { data: repsData }, { data: poseData }, { data: recentSessionsRaw }] = await Promise.all([
    supabase
      .from('session_metrics')
      .select('session_id,start_at,end_at,created_at,shadow_mean_abs_delta,shadow_coverage_ratio,avg_fps')
      .eq('session_id', resolvedSessionId)
      .maybeSingle(),
    supabase
      .from('reps')
      .select('rep_index,fqi,start_ts,end_ts,faults_detected')
      .eq('session_id', resolvedSessionId)
      .order('rep_index', { ascending: true })
      .limit(200),
    supabase
      .from('pose_samples')
      .select('frame_timestamp,phase,rep_number,left_elbow_deg,right_elbow_deg,left_shoulder_deg,right_shoulder_deg,left_knee_deg,right_knee_deg,left_hip_deg,right_hip_deg')
      .eq('session_id', resolvedSessionId)
      .order('frame_timestamp', { ascending: true })
      .limit(2400),
    supabase
      .from('session_metrics')
      .select('session_id,start_at,end_at,created_at,shadow_mean_abs_delta,shadow_coverage_ratio,avg_fps')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const poseRows = (poseData ?? []) as PoseRow[];
  if (poseRows.length === 0) {
    return null;
  }

  const repsRows = (repsData ?? []) as RepsRow[];
  const selectedPair = selectBestJointPair(poseRows);
  const wavePoints = buildWavePoints(poseRows, selectedPair);
  const asymmetry = computeAsymmetry(wavePoints);
  const tempo = buildTempoStats(repsRows);
  const trackingConfidence = computeTrackingConfidence((metricsData as SessionMetricsRow | null) ?? null);

  const sessionRecord = (metricsData as SessionMetricsRow | null) ?? null;
  const sessionDate =
    isoDateFromTimestamp(sessionRecord?.start_at) ??
    isoDateFromTimestamp(sessionRecord?.created_at) ??
    new Date().toISOString().slice(0, 10);

  const recentSessions = ((recentSessionsRaw ?? []) as SessionMetricsRow[]).filter(
    (entry, index, arr) => arr.findIndex((item) => item.session_id === entry.session_id) === index,
  );
  const sessionDates = recentSessions
    .map((entry) => isoDateFromTimestamp(entry.start_at) ?? isoDateFromTimestamp(entry.created_at))
    .filter((value): value is string => typeof value === 'string');

  const minSessionDate = sessionDates.length > 0 ? [...sessionDates].sort()[0] : sessionDate;
  const maxSessionDate = sessionDates.length > 0 ? [...sessionDates].sort().slice(-1)[0] : sessionDate;
  const heartWindow = buildDateWindow(minSessionDate, 7);

  const { data: heartRowsRaw } = await supabase
    .from('health_metrics')
    .select('summary_date,heart_rate_bpm')
    .gte('summary_date', heartWindow.from)
    .lte('summary_date', maxSessionDate)
    .order('summary_date', { ascending: true });
  const heartRows = (heartRowsRaw ?? []) as HealthMetricRow[];

  const trendSessionIds = recentSessions.map((entry) => entry.session_id);
  let trendRepsRows: RepsTrendRow[] = [];
  if (trendSessionIds.length > 0) {
    const { data: trendRepsRaw } = await supabase
      .from('reps')
      .select('session_id,rep_index,fqi,start_ts,end_ts')
      .in('session_id', trendSessionIds)
      .order('session_id', { ascending: true })
      .order('rep_index', { ascending: true })
      .limit(2000);
    trendRepsRows = (trendRepsRaw ?? []) as RepsTrendRow[];
  }

  const currentRepSignals = buildRepDriftSignals(repsRows);
  const currentAsymmetryDrift = buildAsymmetryDrift(poseRows, selectedPair);
  const currentHeartRates = resolveHeartRatesForDate({ sessionDate, heartRows });
  const fatigueSignals = buildFatigueSignals({
    fqiDropPct: currentRepSignals.fqiDropPct,
    tempoDriftPct: currentRepSignals.tempoDriftPct,
    asymmetryDriftDeg: currentAsymmetryDrift,
    heartRateBpm: currentHeartRates.heartRateBpm,
    heartRateBaselineBpm: currentHeartRates.heartRateBaselineBpm,
  });
  const fatigue = scoreFatigueSignals(fatigueSignals);

  const fatigueTrend = buildFatigueTrend({
    sessions: recentSessions,
    repsRows: trendRepsRows,
    heartRows,
  });

  if (
    fatigue.fatigueScore !== null &&
    fatigue.fatigueLevel !== null &&
    !fatigueTrend.some((point) => point.sessionId === resolvedSessionId)
  ) {
    fatigueTrend.push({
      sessionId: resolvedSessionId,
      label: sessionDate.slice(5),
      score: fatigue.fatigueScore,
      level: fatigue.fatigueLevel,
    });
  }

  const coachActions = buildCoachActions({
    fatigueLevel: fatigue.fatigueLevel,
    signals: fatigueSignals,
  });

  const fatigueConfidence = scoreFatigueConfidence({
    repsCount: repsRows.length,
    poseFrameCount: poseRows.length,
    trendPointCount: fatigueTrend.length,
    hasFqiDrop: fatigueSignals.fqiDropPct !== null,
    hasTempoDrift: fatigueSignals.tempoDriftPct !== null,
    hasAsymmetryDrift: fatigueSignals.asymmetryDriftDeg !== null,
    hasHeartRate: fatigueSignals.heartRateBpm !== null,
    hasHeartRateBaseline: fatigueSignals.heartRateBaselineBpm !== null,
    trackingConfidence,
  });

  const validFqi = repsRows.map((row) => row.fqi).filter((value): value is number => typeof value === 'number');
  const avgFqi = validFqi.length > 0 ? Math.round(meanValue(validFqi)) : null;
  const repsCompleted = repsRows.length;

  const drivers = buildDriverCards({
    meanAsymmetryDeg: asymmetry.meanAsymmetryDeg,
    repTempoCv: tempo.repTempoCv,
    trackingConfidence,
  });

  return {
    sessionId: resolvedSessionId,
    waveLabel: selectedPair.label,
    wavePoints,
    meanAsymmetryDeg: asymmetry.meanAsymmetryDeg,
    p95AsymmetryDeg: asymmetry.p95AsymmetryDeg,
    maxAsymmetryDeg: asymmetry.maxAsymmetryDeg,
    asymmetryScore: asymmetry.asymmetryScore,
    repsCompleted,
    avgFqi,
    avgRepDurationMs: tempo.avgRepDurationMs,
    repTempoCv: tempo.repTempoCv,
    trackingConfidence,
    fatigueScore: fatigue.fatigueScore,
    fatigueLevel: fatigue.fatigueLevel,
    fatigueSignals,
    fatigueConfidence,
    fatigueTrend: fatigueTrend.slice(-8),
    coachActions,
    drivers,
  };
}
