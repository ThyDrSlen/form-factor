import {
  getGlossaryEntry,
  getGlossaryEntriesByFaultId,
  getGlossaryVersion,
  __resetGlossaryIndexForTests,
  type FaultGlossaryEntry,
} from '@/lib/services/fault-glossary-store';

describe('fault-glossary-store', () => {
  beforeEach(() => {
    __resetGlossaryIndexForTests();
  });

  it('returns an entry for a known (exerciseId, faultId) pair', () => {
    const entry = getGlossaryEntry('squat', 'knee_valgus');
    expect(entry).not.toBeNull();
    expect(entry!.displayName).toBeTruthy();
    expect(entry!.shortExplanation.length).toBeGreaterThan(0);
    expect(entry!.fullExplanation.length).toBeGreaterThan(0);
    expect(entry!.whyItMatters.length).toBeGreaterThan(0);
    expect(entry!.fixTips.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(entry!.relatedFaults)).toBe(true);
  });

  it('returns null for an unknown pair', () => {
    expect(getGlossaryEntry('squat', 'rainbow_cartwheel')).toBeNull();
    expect(getGlossaryEntry('pogo_stick', 'knee_valgus')).toBeNull();
  });

  it('returns all entries for a fault id across exercises', () => {
    // incomplete_lockout exists for squat, pushup, deadlift
    const entries = getGlossaryEntriesByFaultId('incomplete_lockout');
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const exerciseIds = new Set(entries.map((e) => e.exerciseId));
    expect(exerciseIds.has('squat')).toBe(true);
    expect(exerciseIds.has('pushup')).toBe(true);
    expect(exerciseIds.has('deadlift')).toBe(true);
  });

  it('returns empty array for a fault id that is not in any entry', () => {
    expect(getGlossaryEntriesByFaultId('nonexistent_fault')).toEqual([]);
  });

  it('reports version metadata', () => {
    const info = getGlossaryVersion();
    expect(info.schemaVersion).toBe(1);
    expect(info.source).toBe('hand-authored');
    expect(info.entryCount).toBeGreaterThan(0);
    expect(info.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ensures every entry has the required fields populated', () => {
    const ids = [
      ['squat', 'shallow_depth'],
      ['pullup', 'incomplete_rom'],
      ['pushup', 'hip_sag'],
      ['deadlift', 'rounded_back'],
      ['rdl', 'rounded_back'],
      ['benchpress', 'shallow_depth'],
      ['dead_hang', 'bent_arms'],
      ['farmers_walk', 'lateral_lean'],
    ] as const;
    for (const [ex, fault] of ids) {
      const entry = getGlossaryEntry(ex, fault) as FaultGlossaryEntry | null;
      expect(entry).not.toBeNull();
      expect(entry!.displayName.trim()).not.toBe('');
      expect(entry!.shortExplanation.trim()).not.toBe('');
      expect(entry!.fullExplanation.trim()).not.toBe('');
      expect(entry!.whyItMatters.trim()).not.toBe('');
      expect(entry!.fixTips.every((t) => t.trim().length > 0)).toBe(true);
    }
  });

  it('indexes are cached (second lookup uses the same entry reference)', () => {
    const a = getGlossaryEntry('squat', 'knee_valgus');
    const b = getGlossaryEntry('squat', 'knee_valgus');
    expect(a).toBe(b);
  });

  it('includes at least one entry for each of the 8 bundled exercises', () => {
    const pairs: Array<readonly [string, string]> = [
      ['squat', 'shallow_depth'],
      ['pushup', 'hip_sag'],
      ['pullup', 'incomplete_rom'],
      ['deadlift', 'rounded_back'],
      ['rdl', 'shallow_hinge'],
      ['benchpress', 'elbow_flare'],
      ['dead_hang', 'bent_arms'],
      ['farmers_walk', 'lateral_lean'],
    ];
    for (const [ex, fault] of pairs) {
      expect(getGlossaryEntry(ex, fault)).not.toBeNull();
    }
  });
});
