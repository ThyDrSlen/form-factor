import {
  staticPersonalizedCueRunner,
  getPersonalizedCueRunner,
  setPersonalizedCueRunner,
  __resetPersonalizedCueForTests,
  type CueInput,
  type PersonalizedCueRunner,
} from '@/lib/services/personalized-cue';

// The glossary store reads from a bundled JSON. All tests use faults that
// exist in the seed data (squat/shallow_depth, squat/knee_valgus, etc.) so
// no mocking of the store is required.

describe('staticPersonalizedCueRunner', () => {
  it('returns the fallback cue for an unknown fault', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'nonexistent_fault_xyz',
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    expect(out.cue).toBe('Nothing more to add.');
    expect(out.referencesHistory).toBe(false);
    expect(out.source).toBe('static');
  });

  it('returns the short explanation for a first-timer with no history', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      // no userHistory provided
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    expect(out.cue).toContain('not descending low enough');
    expect(out.referencesHistory).toBe(false);
    expect(out.source).toBe('static');
  });

  it('returns short explanation when userHistory entry has totalOccurrences 0', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      userHistory: [
        { faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 0 },
      ],
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    expect(out.referencesHistory).toBe(false);
    expect(out.cue).toContain('not descending low enough');
  });

  it('prepends the third-session prefix when totalOccurrences >= 3 and lastSeenSessionsAgo <= 1', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      userHistory: [
        { faultId: 'shallow_depth', lastSeenSessionsAgo: 1, totalOccurrences: 3 },
      ],
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    expect(out.cue.startsWith('Third session in a row on this one — ')).toBe(true);
    expect(out.cue).toContain('not descending low enough');
    expect(out.referencesHistory).toBe(true);
    expect(out.source).toBe('static');
  });

  it('does NOT prepend when totalOccurrences >= 3 but lastSeenSessionsAgo > 1 (stale)', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      userHistory: [
        { faultId: 'shallow_depth', lastSeenSessionsAgo: 2, totalOccurrences: 5 },
      ],
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    expect(out.cue.startsWith('Third session in a row on this one — ')).toBe(false);
    expect(out.referencesHistory).toBe(false);
  });

  it('returns fixTips[0] when user has 1 or 2 occurrences (returning user, not third-session)', async () => {
    const input: CueInput = {
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      userHistory: [
        { faultId: 'shallow_depth', lastSeenSessionsAgo: 0, totalOccurrences: 2 },
      ],
    };
    const out = await staticPersonalizedCueRunner.getCue(input);
    // fixTips[0] for squat/shallow_depth is about hip mobility warmup
    expect(out.cue).toContain('Warm up your hip mobility');
    expect(out.referencesHistory).toBe(false);
  });
});

describe('pluggable runner singleton', () => {
  afterEach(() => {
    __resetPersonalizedCueForTests();
  });

  it('starts with the static runner by default', () => {
    expect(getPersonalizedCueRunner()).toBe(staticPersonalizedCueRunner);
  });

  it('swap works: fake runner returns gemma-local source, then reverts to static on null', async () => {
    const fakeRunner: PersonalizedCueRunner = {
      async getCue(_input) {
        return { cue: 'fake cue', referencesHistory: false, source: 'gemma-local' };
      },
    };

    setPersonalizedCueRunner(fakeRunner);
    expect(getPersonalizedCueRunner()).toBe(fakeRunner);

    const out = await getPersonalizedCueRunner().getCue({
      exerciseId: 'squat',
      faultId: 'shallow_depth',
    });
    expect(out.source).toBe('gemma-local');
    expect(out.cue).toBe('fake cue');

    // Revert with null
    setPersonalizedCueRunner(null);
    expect(getPersonalizedCueRunner()).toBe(staticPersonalizedCueRunner);
  });
});
