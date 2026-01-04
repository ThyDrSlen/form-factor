export type RecordingQuality = 'low' | 'medium' | 'high';

export function buildVideoMetricsForClip<TBaseMetrics extends Record<string, unknown>>(opts: {
  baseMetrics: TBaseMetrics;
  sessionId: string;
  recordingQuality: RecordingQuality;
  recordingStartAt: string;
  recordingEndAt: string;
  recordingStartFrameTimestamp: number | null;
  recordingEndFrameTimestamp: number | null;
  repFqiScores: number[];
}): TBaseMetrics & {
  avgFqi: number | null;
  formScore: number | null;
  sessionId: string;
  recordingQuality: RecordingQuality;
  recordingStartAt: string;
  recordingEndAt: string;
  recordingStartFrameTimestamp: number | null;
  recordingEndFrameTimestamp: number | null;
} {
  const { repFqiScores } = opts;
  const avgFqi =
    repFqiScores.length > 0
      ? Math.round(repFqiScores.reduce((sum, score) => sum + score, 0) / repFqiScores.length)
      : null;

  return {
    ...opts.baseMetrics,
    avgFqi,
    formScore: avgFqi,
    sessionId: opts.sessionId,
    recordingQuality: opts.recordingQuality,
    recordingStartAt: opts.recordingStartAt,
    recordingEndAt: opts.recordingEndAt,
    recordingStartFrameTimestamp: opts.recordingStartFrameTimestamp,
    recordingEndFrameTimestamp: opts.recordingEndFrameTimestamp,
  };
}

