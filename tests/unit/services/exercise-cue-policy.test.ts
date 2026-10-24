import { ExerciseCuePolicy, type ExerciseAudioCue, type ExerciseAudioObservation } from '@/lib/services/exercise-cue-policy';

const shoulder: ExerciseAudioCue = { issueId: 'shoulder', message: 'Lower your shoulders.', priority: 2, kind: 'form' };
const wrist: ExerciseAudioCue = { issueId: 'wrist', message: 'Bring your wrists into view.', priority: 1, kind: 'visibility' };
const snapshot = (sampleId: number, candidates = [shoulder], overrides: Partial<ExerciseAudioObservation> = {}): ExerciseAudioObservation => ({
  contextKey: 'session:pullup', sampleId, trackingConfidence: 0.9, atRepBoundary: true, candidates, ...overrides,
});
function sustain(policy: ExerciseCuePolicy, start = 0, candidates = [shoulder], overrides: Partial<ExerciseAudioObservation> = {}) {
  let result: ExerciseAudioCue | null = null;
  for (let now = start; now <= start + 1500; now += 500) result = policy.observe(snapshot(now, candidates, overrides), now);
  return result;
}

describe('ExerciseCuePolicy', () => {
  it('binds playback validity to current issue evidence, context, and fresh raw samples', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy);
    policy.markSpoken(shoulder, 1500);
    expect(policy.validUntil(shoulder, 'session:pullup', 1500)).toBe(2250);
    expect(policy.validUntil(shoulder, 'session:other', 1500)).toBeNull();
    expect(policy.validUntil({ ...shoulder, message: 'Other advice' }, 'session:pullup', 1500)).toBeNull();
    policy.observe(snapshot(1500), 2200); // Held sample cannot renew the lease.
    expect(policy.validUntil(shoulder, 'session:pullup', 2251)).toBeNull();
    policy.observe(snapshot(2300, []), 2300);
    expect(policy.validUntil(shoulder, 'session:pullup', 2300)).toBeNull();
    expect(sustain(policy, 12000)).toBeNull(); // Cancellation is not correction.
  });
  it('selects just the highest priority problem regardless of input order', () => {
    expect(sustain(new ExerciseCuePolicy(), 0, [shoulder, wrist])).toEqual(wrist);
  });
  it('defers form coaching during a rep and revalidates at the boundary', () => {
    const policy = new ExerciseCuePolicy();
    expect(sustain(policy, 0, [shoulder], { atRepBoundary: false })).toBeNull();
    expect(policy.observe(snapshot(2000), 2000)).toEqual(shoulder);
  });
  it('does not accumulate persistence across tracking gaps', () => {
    const policy = new ExerciseCuePolicy();
    policy.observe(snapshot(0), 0);
    expect(policy.observe(snapshot(10000), 10000)).toBeNull();
  });
  it('deduplicates the same issue across wording, phase, and elapsed time', () => {
    const policy = new ExerciseCuePolicy();
    expect(sustain(policy)).toEqual(shoulder);
    policy.markSpoken(shoulder, 1500);
    expect(sustain(policy, 20000, [{ ...shoulder, message: 'Different wording' }])).toBeNull();
  });
  it('rearms only after sustained confident correction, never dropout', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy);
    policy.markSpoken(shoulder, 1500);
    for (let now = 2000; now <= 12000; now += 500) policy.observe(snapshot(now, [], { trackingConfidence: null }), now);
    expect(sustain(policy, 12500)).toBeNull();
    for (let now = 14500; now <= 17500; now += 500) policy.observe(snapshot(now, [], { resolvedIssueIds: ['shoulder'] }), now);
    expect(sustain(policy, 18000)).toEqual(shoulder);
  });
  it('rearms on meaningful context changes but preserves the global cooldown', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy);
    policy.markSpoken(shoulder, 1500);
    expect(sustain(policy, 2000, [shoulder], { contextKey: 'session:other-exercise' })).toBeNull();
    expect(sustain(policy, 10000, [shoulder], { contextKey: 'session:other-exercise' })).toEqual(shoulder);
  });
  it('does not narrate lower-priority problems while the highest issue remains uncorrected', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy, 0, [wrist]);
    policy.markSpoken(wrist, 1500);
    expect(sustain(policy, 12000, [shoulder, wrist])).toBeNull();
  });
  it('drops boundary advice when the problem has already resolved', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy, 0, [shoulder], { atRepBoundary: false });
    expect(policy.observe(snapshot(2000, []), 2000)).toBeNull();
  });
  it('does not rearm on an empty cue list in an unrelated phase', () => {
    const policy = new ExerciseCuePolicy();
    sustain(policy);
    policy.markSpoken(shoulder, 1500);
    for (let now = 2000; now <= 12000; now += 500) policy.observe(snapshot(now, []), now);
    expect(sustain(policy, 12500)).toBeNull();
  });
  it('does not count held or duplicate frames as sustained evidence', () => {
    const policy = new ExerciseCuePolicy();
    policy.observe(snapshot(0), 0);
    expect(policy.observe(snapshot(0), 1500)).toBeNull();
  });
});
