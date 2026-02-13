import {
  buildCoachActions,
  buildWavePoints,
  computeAsymmetry,
  scoreFatigueConfidence,
  scoreFatigueSignals,
  selectBestJointPair,
} from '@/lib/services/workout-insights-helpers';

const rows = Array.from({ length: 10 }, (_, index) => ({
  frame_timestamp: index * 0.033,
  rep_number: index < 5 ? 1 : 2,
  phase: index < 5 ? 'pull' : 'hang',
  left_elbow_deg: 95 + index,
  right_elbow_deg: 93 + index,
  left_shoulder_deg: 84 + index,
  right_shoulder_deg: 84 + index,
  left_knee_deg: 130 + index * 0.5,
  right_knee_deg: 129 + index * 0.5,
  left_hip_deg: 145 + index * 0.4,
  right_hip_deg: 144 + index * 0.4,
}));

test('selectBestJointPair returns the pair with strongest coverage signal', () => {
  const pair = selectBestJointPair(rows);
  expect(pair.left).toBe('left_elbow_deg');
  expect(pair.right).toBe('right_elbow_deg');
});

test('buildWavePoints down-samples rows and preserves rep grouping', () => {
  const pair = selectBestJointPair(rows);
  const points = buildWavePoints(rows, pair, 4);
  expect(points.length).toBe(4);
  expect(points[0].repNumber).toBe(1);
  expect(points[3].repNumber).toBe(2);
  expect(points[0].phase).toBe('pull');
  expect(points[3].phase).toBe('hang');
});

test('computeAsymmetry creates bounded score from wave deltas', () => {
  const asymmetry = computeAsymmetry([
    { index: 0, left: 100, right: 98, repNumber: 1, phase: null },
    { index: 1, left: 110, right: 105, repNumber: 1, phase: null },
    { index: 2, left: 90, right: 87, repNumber: 2, phase: null },
  ]);

  expect(asymmetry.meanAsymmetryDeg).toBeGreaterThan(2);
  expect(asymmetry.maxAsymmetryDeg).toBe(5);
  expect(asymmetry.asymmetryScore).toBeGreaterThanOrEqual(0);
  expect(asymmetry.asymmetryScore).toBeLessThanOrEqual(100);
});

test('scoreFatigueSignals outputs high fatigue for strong drift signals', () => {
  const scored = scoreFatigueSignals({
    fqiDropPct: 22,
    tempoDriftPct: 18,
    asymmetryDriftDeg: 7,
    heartRateBpm: 162,
    heartRateBaselineBpm: 142,
    heartRateStrainBpm: 20,
  });

  expect(scored.fatigueScore).toBeGreaterThanOrEqual(61);
  expect(scored.fatigueLevel).toBe('high');
});

test('buildCoachActions prioritizes fatigue mitigation actions', () => {
  const actions = buildCoachActions({
    fatigueLevel: 'high',
    signals: {
      fqiDropPct: 16,
      tempoDriftPct: 14,
      asymmetryDriftDeg: 5,
      heartRateBpm: 154,
      heartRateBaselineBpm: 142,
      heartRateStrainBpm: 12,
    },
  });

  expect(actions.length).toBeGreaterThan(0);
  expect(actions[0].priority).toBe('high');
});

test('scoreFatigueConfidence reports high confidence with rich signals', () => {
  const confidence = scoreFatigueConfidence({
    repsCount: 12,
    poseFrameCount: 760,
    trendPointCount: 6,
    hasFqiDrop: true,
    hasTempoDrift: true,
    hasAsymmetryDrift: true,
    hasHeartRate: true,
    hasHeartRateBaseline: true,
    trackingConfidence: 0.9,
  });

  expect(confidence.score).toBeGreaterThanOrEqual(75);
  expect(confidence.level).toBe('high');
});

test('scoreFatigueConfidence returns insufficient when signals are sparse', () => {
  const confidence = scoreFatigueConfidence({
    repsCount: 1,
    poseFrameCount: 30,
    trendPointCount: 0,
    hasFqiDrop: false,
    hasTempoDrift: false,
    hasAsymmetryDrift: false,
    hasHeartRate: false,
    hasHeartRateBaseline: false,
    trackingConfidence: null,
  });

  expect(confidence.level).toBe('insufficient');
  expect(confidence.score).toBeNull();
});
