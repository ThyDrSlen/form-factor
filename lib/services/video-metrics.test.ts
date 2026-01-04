import { buildVideoMetricsForClip } from './video-metrics';

describe('buildVideoMetricsForClip', () => {
  test('adds avgFqi + formScore alias and recording metadata', () => {
    const metrics = buildVideoMetricsForClip({
      baseMetrics: { mode: 'pullup', reps: 12, avgElbowDeg: 123, avgShoulderDeg: 111, headToHand: null },
      sessionId: 'session-123',
      recordingQuality: 'high',
      recordingStartAt: '2026-01-02T10:00:00.000Z',
      recordingEndAt: '2026-01-02T10:00:10.000Z',
      recordingStartFrameTimestamp: 1000.5,
      recordingEndFrameTimestamp: 1010.5,
      repFqiScores: [80, 90, 100],
    });

    expect(metrics).toMatchObject({
      mode: 'pullup',
      reps: 12,
      avgFqi: 90,
      formScore: 90,
      sessionId: 'session-123',
      recordingQuality: 'high',
      recordingStartAt: '2026-01-02T10:00:00.000Z',
      recordingEndAt: '2026-01-02T10:00:10.000Z',
      recordingStartFrameTimestamp: 1000.5,
      recordingEndFrameTimestamp: 1010.5,
    });
  });

  test('uses null avgFqi/formScore when no rep scores are available', () => {
    const metrics = buildVideoMetricsForClip({
      baseMetrics: { mode: 'pushup', reps: 0, avgElbowDeg: null, hipDropRatio: null },
      sessionId: 'session-123',
      recordingQuality: 'low',
      recordingStartAt: '2026-01-02T10:00:00.000Z',
      recordingEndAt: '2026-01-02T10:00:10.000Z',
      recordingStartFrameTimestamp: null,
      recordingEndFrameTimestamp: null,
      repFqiScores: [],
    });

    expect(metrics.avgFqi).toBeNull();
    expect(metrics.formScore).toBeNull();
  });
});

