import {
  bucketFor,
  fnv1a,
  isInCohort,
  readCohortPct,
} from '@/lib/services/coach-rollout';

const ENV_KEY = 'EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT';

describe('coach-rollout / fnv1a', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a('user-123')).toBe(fnv1a('user-123'));
  });

  it('returns distinct hashes for distinct inputs', () => {
    expect(fnv1a('user-a')).not.toBe(fnv1a('user-b'));
  });

  it('always returns an unsigned 32-bit integer', () => {
    const h = fnv1a('any-seed');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('coach-rollout / bucketFor', () => {
  it('produces a bucket in [0, 99]', () => {
    for (const id of ['a', 'user-999', 'deadbeef-1234']) {
      const b = bucketFor(id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(99);
    }
  });

  it('is deterministic — same id yields same bucket', () => {
    expect(bucketFor('user-42')).toBe(bucketFor('user-42'));
  });

  it('returns -1 for missing id', () => {
    expect(bucketFor(null)).toBe(-1);
    expect(bucketFor(undefined)).toBe(-1);
    expect(bucketFor('')).toBe(-1);
  });
});

describe('coach-rollout / readCohortPct', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('defaults to 0 when env is missing', () => {
    delete process.env[ENV_KEY];
    expect(readCohortPct()).toBe(0);
  });

  it('reads from env as integer', () => {
    process.env[ENV_KEY] = '25';
    expect(readCohortPct()).toBe(25);
  });

  it('clamps env to [0, 100]', () => {
    process.env[ENV_KEY] = '150';
    expect(readCohortPct()).toBe(100);
    process.env[ENV_KEY] = '-5';
    expect(readCohortPct()).toBe(0);
  });

  it('accepts caller override which wins over env', () => {
    process.env[ENV_KEY] = '10';
    expect(readCohortPct(50)).toBe(50);
  });

  it('ignores non-numeric env values', () => {
    process.env[ENV_KEY] = 'abc';
    expect(readCohortPct()).toBe(0);
  });
});

describe('coach-rollout / isInCohort', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('returns false when cohort pct is 0 regardless of user', () => {
    delete process.env[ENV_KEY];
    expect(isInCohort('user-1')).toBe(false);
  });

  it('returns true when pct is 100 and userId is present', () => {
    expect(isInCohort('user-1', 100)).toBe(true);
  });

  it('returns false when userId is missing even at 100% cohort', () => {
    expect(isInCohort(null, 100)).toBe(false);
    expect(isInCohort(undefined, 100)).toBe(false);
  });

  it('bucket decisions are stable across calls', () => {
    const id = 'deterministic-user';
    const first = isInCohort(id, 50);
    const second = isInCohort(id, 50);
    expect(first).toBe(second);
  });

  it('roughly partitions a large random population by pct (+/- tolerance)', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `user-${i}-${i * 7}`);
    const pct = 30;
    const count = ids.filter((id) => isInCohort(id, pct)).length;
    // Accept 10% tolerance around the target.
    expect(count / ids.length).toBeGreaterThan(0.2);
    expect(count / ids.length).toBeLessThan(0.4);
  });
});
