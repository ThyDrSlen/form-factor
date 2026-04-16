import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  flagRepPain,
  getPainFlags,
  deletePainFlag,
  clearPainJournal,
  painJournalKey,
  computeWeightReductionFraction,
  adjustNextSetWeight,
  syncToSupabase,
  PAIN_LOCATION_LABELS,
} from '@/lib/services/rep-pain-journal';

const USER = 'user-test-1';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

describe('painJournalKey', () => {
  it('namespaces under pain-journal:v1:<userId>', () => {
    expect(painJournalKey('abc')).toBe('pain-journal:v1:abc');
  });

  it('throws on empty / non-string userId', () => {
    expect(() => painJournalKey('')).toThrow();
    // @ts-expect-error — deliberate bad input
    expect(() => painJournalKey(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// flagRepPain + getPainFlags
// ---------------------------------------------------------------------------

describe('flagRepPain', () => {
  it('writes a flag to AsyncStorage keyed by userId', async () => {
    const flag = await flagRepPain(USER, {
      repId: 'set1:2',
      sessionId: 'sess1',
      location: 'lower_back',
      severity: 3,
      notes: 'Twinge on rep 2',
    });
    expect(flag.id).toMatch(/^pf_/);
    expect(flag.location).toBe('lower_back');
    expect(flag.severity).toBe(3);
    expect(flag.notes).toBe('Twinge on rep 2');
    expect(flag.synced).toBe(false);
    expect(flag.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const raw = await AsyncStorage.getItem(painJournalKey(USER));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('clamps severity to [1..5]', async () => {
    const tooLow = await flagRepPain(USER, {
      repId: 'r',
      sessionId: 's',
      location: 'knee',
      // @ts-expect-error — invalid but we want to exercise clamp
      severity: 0,
    });
    const tooHigh = await flagRepPain(USER, {
      repId: 'r',
      sessionId: 's',
      location: 'knee',
      // @ts-expect-error — invalid but we want to exercise clamp
      severity: 99,
    });
    expect(tooLow.severity).toBe(1);
    expect(tooHigh.severity).toBe(5);
  });

  it('truncates notes to 500 chars', async () => {
    const flag = await flagRepPain(USER, {
      repId: 'r',
      sessionId: 's',
      location: 'other',
      severity: 2,
      notes: 'x'.repeat(1000),
    });
    expect(flag.notes?.length).toBe(500);
  });

  it('preserves caller-supplied id', async () => {
    const flag = await flagRepPain(USER, {
      id: 'pf_custom_1',
      repId: 'r',
      sessionId: 's',
      location: 'wrist',
      severity: 1,
    });
    expect(flag.id).toBe('pf_custom_1');
  });

  it('accumulates multiple flags for the same user', async () => {
    await flagRepPain(USER, { repId: 'r1', sessionId: 's', location: 'hip', severity: 1 });
    await flagRepPain(USER, { repId: 'r2', sessionId: 's', location: 'hip', severity: 2 });
    await flagRepPain(USER, { repId: 'r3', sessionId: 's', location: 'hip', severity: 3 });
    const flags = await getPainFlags(USER);
    expect(flags).toHaveLength(3);
  });

  it('isolates storage between users', async () => {
    await flagRepPain('u1', { repId: 'r', sessionId: 's', location: 'hip', severity: 1 });
    await flagRepPain('u2', { repId: 'r', sessionId: 's', location: 'hip', severity: 2 });
    expect(await getPainFlags('u1')).toHaveLength(1);
    expect(await getPainFlags('u2')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getPainFlags — date range filtering and sorting
// ---------------------------------------------------------------------------

describe('getPainFlags', () => {
  it('returns empty array for an unknown user', async () => {
    expect(await getPainFlags('no-such-user')).toEqual([]);
  });

  it('sorts results newest-first', async () => {
    // Manually seed with varying timestamps so ordering is deterministic.
    const now = Date.now();
    const flags = [
      {
        id: 'old',
        repId: 'r1',
        sessionId: 's',
        location: 'hip',
        severity: 1,
        createdAt: new Date(now - 60_000).toISOString(),
        synced: false,
      },
      {
        id: 'new',
        repId: 'r2',
        sessionId: 's',
        location: 'hip',
        severity: 2,
        createdAt: new Date(now).toISOString(),
        synced: false,
      },
    ];
    await AsyncStorage.setItem(painJournalKey(USER), JSON.stringify(flags));
    const sorted = await getPainFlags(USER);
    expect(sorted.map((f) => f.id)).toEqual(['new', 'old']);
  });

  it('filters out flags older than the window', async () => {
    const now = Date.now();
    const flags = [
      {
        id: 'ancient',
        repId: 'r1',
        sessionId: 's',
        location: 'hip',
        severity: 1,
        // 60 days ago
        createdAt: new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString(),
        synced: false,
      },
      {
        id: 'recent',
        repId: 'r2',
        sessionId: 's',
        location: 'hip',
        severity: 2,
        // 5 days ago
        createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        synced: false,
      },
    ];
    await AsyncStorage.setItem(painJournalKey(USER), JSON.stringify(flags));
    const last30 = await getPainFlags(USER, 30);
    expect(last30.map((f) => f.id)).toEqual(['recent']);
  });

  it('returns all flags when days=Infinity', async () => {
    const now = Date.now();
    const flags = [
      {
        id: 'ancient',
        repId: 'r1',
        sessionId: 's',
        location: 'hip',
        severity: 1,
        createdAt: new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString(),
        synced: false,
      },
    ];
    await AsyncStorage.setItem(painJournalKey(USER), JSON.stringify(flags));
    expect(await getPainFlags(USER, Infinity)).toHaveLength(1);
  });

  it('ignores malformed entries in storage', async () => {
    await AsyncStorage.setItem(
      painJournalKey(USER),
      JSON.stringify([
        { id: 'good', repId: 'r', sessionId: 's', location: 'hip', severity: 1, createdAt: new Date().toISOString(), synced: false },
        { id: 'bad' }, // missing required fields
        'not an object',
        null,
      ]),
    );
    const flags = await getPainFlags(USER);
    expect(flags).toHaveLength(1);
    expect(flags[0].id).toBe('good');
  });

  it('returns empty array if storage holds invalid JSON', async () => {
    await AsyncStorage.setItem(painJournalKey(USER), 'not-json');
    expect(await getPainFlags(USER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// delete + clear
// ---------------------------------------------------------------------------

describe('deletePainFlag + clearPainJournal', () => {
  it('deletes a single flag by id', async () => {
    const a = await flagRepPain(USER, { repId: 'r1', sessionId: 's', location: 'hip', severity: 1 });
    const b = await flagRepPain(USER, { repId: 'r2', sessionId: 's', location: 'hip', severity: 2 });
    await deletePainFlag(USER, a.id);
    const flags = await getPainFlags(USER);
    expect(flags.map((f) => f.id)).toEqual([b.id]);
  });

  it('is a no-op if the flag id does not exist', async () => {
    await flagRepPain(USER, { repId: 'r1', sessionId: 's', location: 'hip', severity: 1 });
    await deletePainFlag(USER, 'pf_not_present');
    expect(await getPainFlags(USER)).toHaveLength(1);
  });

  it('clearPainJournal wipes the key entirely', async () => {
    await flagRepPain(USER, { repId: 'r1', sessionId: 's', location: 'hip', severity: 1 });
    await clearPainJournal(USER);
    expect(await AsyncStorage.getItem(painJournalKey(USER))).toBeNull();
    expect(await getPainFlags(USER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Weight-adjust helpers
// ---------------------------------------------------------------------------

describe('computeWeightReductionFraction', () => {
  it('returns severity * 2%', () => {
    expect(computeWeightReductionFraction(1)).toBeCloseTo(0.02, 5);
    expect(computeWeightReductionFraction(2)).toBeCloseTo(0.04, 5);
    expect(computeWeightReductionFraction(3)).toBeCloseTo(0.06, 5);
    expect(computeWeightReductionFraction(4)).toBeCloseTo(0.08, 5);
    expect(computeWeightReductionFraction(5)).toBeCloseTo(0.10, 5);
  });

  it('caps at 15% even if severity extrapolates higher (defensive)', () => {
    // Cast so we can test the cap branch without relying on clamp upstream.
    // @ts-expect-error — defensive upper bound
    expect(computeWeightReductionFraction(20)).toBeLessThanOrEqual(0.15);
  });
});

describe('adjustNextSetWeight', () => {
  it('returns a negative delta fraction tagged with sessionId + severity', () => {
    const res = adjustNextSetWeight('sess-1', 3);
    expect(res.sessionId).toBe('sess-1');
    expect(res.severity).toBe(3);
    expect(res.recommendedDeltaFraction).toBeCloseTo(-0.06, 5);
  });
});

// ---------------------------------------------------------------------------
// syncToSupabase stub
// ---------------------------------------------------------------------------

describe('syncToSupabase (stub)', () => {
  it('returns a no-op payload flagged as migration_pending', async () => {
    const res = await syncToSupabase(USER);
    expect(res.attempted).toBe(0);
    expect(res.synced).toBe(0);
    expect(res.skipped).toBe('migration_pending');
  });

  it('does not read or write AsyncStorage', async () => {
    // Clear prior-call tallies first — beforeEach() invokes AsyncStorage.clear,
    // which increments the jest-mock counters for this suite.
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await syncToSupabase(USER);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Location labels export
// ---------------------------------------------------------------------------

describe('PAIN_LOCATION_LABELS', () => {
  it('maps every location type to a human-readable label', () => {
    expect(PAIN_LOCATION_LABELS.lower_back).toBe('Lower back');
    expect(PAIN_LOCATION_LABELS.upper_back).toBe('Upper back');
    expect(PAIN_LOCATION_LABELS.knee).toBe('Knee');
    expect(PAIN_LOCATION_LABELS.shoulder).toBe('Shoulder');
    expect(PAIN_LOCATION_LABELS.elbow).toBe('Elbow');
    expect(PAIN_LOCATION_LABELS.wrist).toBe('Wrist');
    expect(PAIN_LOCATION_LABELS.hip).toBe('Hip');
    expect(PAIN_LOCATION_LABELS.other).toBe('Other');
  });
});
