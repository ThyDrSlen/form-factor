import { learnPersonalForm, buildPersonalFormObservations, rateHypertrophyTraining } from '@/lib/services/personalized-coaching';

const DAY = 86400000;
function fixture(count = 40) { return Array.from({ length: count }, (_, i) => ({ id: `s${i}`, exercise: 'squat', startAt: (i + 1) * 4 * DAY, endAt: (i + 1) * 4 * DAY + 60000, restHours: 24 + (i % 4) * 12, fqi: 50 + (i % 4) * 10 })); }
it('joins only prior same-exercise tracked sessions; missing history remains unknown', () => {
  const reps = [1, 2, 3].flatMap(day => [0, 1, 2].map(i => ({
    rep_id: `${day}-${i}`, session_id: `s${day}`, exercise: 'squat',
    start_ts: new Date(day * DAY + i * 1000).toISOString(),
    end_ts: new Date(day * DAY + (i + 1) * 1000).toISOString(), fqi: 70 + i,
  })));
  const rows = buildPersonalFormObservations(reps.reverse());
  expect(rows[0].restHours).toBeNull();
  expect(rows[1].restHours).toBeCloseTo(24 - 3 / 3600);
  expect(rows[1].fqi).toBe(71);
  expect(buildPersonalFormObservations([...reps, ...reps])).toEqual(rows);
  expect(buildPersonalFormObservations(reps.filter(row => row.rep_id !== '2-2')).find(row => row.id === 's2')?.fqi).toBeNull();
});

describe('rule-based hypertrophy training proxy', () => {
  it('reports observed rep-range support, excludes warmups and never imputes missing effort', () => {
    const sets = [8, 12, 20, 3, null].map((actual_reps, i) => ({ id: `${i}`, set_type: 'normal', actual_reps }));
    const rating = rateHypertrophyTraining([...sets, { id: 'warm', set_type: 'warmup', actual_reps: 10 }]);
    expect(rating).toMatchObject({ score: 75, eligibleSets: 4, inRangeSets: 3, unknownSets: 1, excludedSets: 1, overallQuality: null });
    expect(rating.limitations).toContain('Effort / proximity to failure is unknown.');
    expect(rateHypertrophyTraining([]).score).toBeNull();
    expect(rateHypertrophyTraining(sets.slice(0, 2)).score).toBeNull();
    expect(rateHypertrophyTraining([...sets, ...sets])).toEqual(rateHypertrophyTraining(sets));
  });
});

describe('personal form learning', () => {
  it('suppresses sparse history instead of inventing recovery readiness', () => {
    expect(learnPersonalForm(fixture(8))).toMatchObject({ status: 'insufficient', sampleCount: 8, confidence: 'insufficient', model: null });
  });
  it('learns only when it beats a chronological holdout baseline without leakage', () => {
    const result = learnPersonalForm(fixture());
    expect(result).toMatchObject({ status: 'validated', confidence: 'tentative', trainCount: 28, holdoutCount: 12 });
    expect(result.model!.slope).toBeGreaterThan(0);
    expect(result.modelMae!).toBeLessThan(result.baselineMae! * 0.9);
    expect(result.trainEnd!).toBeLessThan(result.holdoutStart!);
    const altered = fixture().map((row, i) => i < 28 ? row : { ...row, fqi: 100 - row.fqi });
    const failed = learnPersonalForm(altered);
    expect(failed.model).toEqual(result.model);
    expect(failed.status).toBe('not-validated');
  });
  it('counts independent days, excludes invalid/duplicate rows and never pools exercises', () => {
    expect(learnPersonalForm([...fixture(8), ...fixture(8)])).toMatchObject({ sampleCount: 8, status: 'insufficient' });
    const mixed = fixture().map((row, i) => ({ ...row, exercise: i % 2 ? 'squat' : 'curl' }));
    expect(learnPersonalForm(mixed).status).toBe('insufficient');
    const sameDay = fixture().map(row => ({ ...row, startAt: DAY, endAt: DAY + 1 }));
    expect(learnPersonalForm(sameDay).status).toBe('insufficient');
    expect(learnPersonalForm(fixture().map(row => ({ ...row, fqi: NaN }))).sampleCount).toBe(0);
    expect(learnPersonalForm(fixture().map(row => ({ ...row, restHours: null }))).sampleCount).toBe(0);
    expect(learnPersonalForm(fixture().map(row => ({ ...row, fqi: 60 }))).status).toBe('not-validated');
    const outsideRange = fixture().map((row, i) => i < 28 ? row : { ...row, restHours: 150 });
    expect(learnPersonalForm(outsideRange).status).toBe('not-validated');
  });
});
