import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SESSION_SNAPSHOT_MAX_ENTRIES,
  SESSION_SNAPSHOT_SCHEMA_VERSION,
  SESSION_SNAPSHOT_STORAGE_KEY,
  clearSessionSnapshots,
  deleteSessionSnapshot,
  listSessionSnapshots,
  saveSessionSnapshot,
} from '@/lib/services/session-snapshot';

const baseInput = () => ({
  exerciseKey: 'pullup',
  repCount: 7,
  currentFqi: 84,
  faults: [{ key: 'shallow_rom', count: 2 }],
  startedAt: '2026-04-20T10:00:00.000Z',
  sessionId: 'sess_abc',
});

describe('session-snapshot', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('saveSessionSnapshot', () => {
    it('persists a record and returns it', async () => {
      const record = await saveSessionSnapshot(baseInput());

      expect(record.id).toMatch(/^snap_/);
      expect(record.exerciseKey).toBe('pullup');
      expect(record.repCount).toBe(7);
      expect(record.currentFqi).toBe(84);
      expect(record.schemaVersion).toBe(SESSION_SNAPSHOT_SCHEMA_VERSION);
      expect(record.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const stored = await listSessionSnapshots();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(record.id);
    });

    it('stores newest first', async () => {
      const a = await saveSessionSnapshot({ ...baseInput(), exerciseKey: 'squat' });
      await new Promise((r) => setTimeout(r, 2));
      const b = await saveSessionSnapshot({ ...baseInput(), exerciseKey: 'pushup' });

      const stored = await listSessionSnapshots();
      expect(stored[0].id).toBe(b.id);
      expect(stored[1].id).toBe(a.id);
    });

    it('rounds repCount down and floors at zero', async () => {
      const r1 = await saveSessionSnapshot({ ...baseInput(), repCount: 6.9 });
      expect(r1.repCount).toBe(6);
      const r2 = await saveSessionSnapshot({ ...baseInput(), repCount: -3 });
      expect(r2.repCount).toBe(0);
    });

    it('clamps currentFqi into [0..100]', async () => {
      const r1 = await saveSessionSnapshot({ ...baseInput(), currentFqi: 160 });
      expect(r1.currentFqi).toBe(100);
      const r2 = await saveSessionSnapshot({ ...baseInput(), currentFqi: -10 });
      expect(r2.currentFqi).toBe(0);
    });

    it('preserves a null currentFqi', async () => {
      const r = await saveSessionSnapshot({ ...baseInput(), currentFqi: null });
      expect(r.currentFqi).toBeNull();
    });

    it('caps the in-store history at SESSION_SNAPSHOT_MAX_ENTRIES', async () => {
      for (let i = 0; i < SESSION_SNAPSHOT_MAX_ENTRIES + 5; i += 1) {
        await saveSessionSnapshot({ ...baseInput(), exerciseKey: `ex-${i}` });
      }
      const stored = await listSessionSnapshots();
      expect(stored).toHaveLength(SESSION_SNAPSHOT_MAX_ENTRIES);
      // newest should be the last one inserted
      expect(stored[0].exerciseKey).toBe(`ex-${SESSION_SNAPSHOT_MAX_ENTRIES + 4}`);
    });

    it('throws when exerciseKey is missing', async () => {
      await expect(
        saveSessionSnapshot({ ...baseInput(), exerciseKey: '' }),
      ).rejects.toThrow(/exerciseKey/);
    });

    it('throws when startedAt is missing', async () => {
      await expect(
        saveSessionSnapshot({ ...baseInput(), startedAt: '' }),
      ).rejects.toThrow(/startedAt/);
    });

    it('throws when repCount is NaN', async () => {
      await expect(
        saveSessionSnapshot({ ...baseInput(), repCount: Number.NaN }),
      ).rejects.toThrow(/repCount/);
    });
  });

  describe('listSessionSnapshots', () => {
    it('returns an empty array when nothing is stored', async () => {
      await expect(listSessionSnapshots()).resolves.toEqual([]);
    });

    it('returns empty when storage is corrupt JSON', async () => {
      await AsyncStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, '{garbage');
      await expect(listSessionSnapshots()).resolves.toEqual([]);
    });

    it('returns empty when stored value is not an array', async () => {
      await AsyncStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, JSON.stringify({ hello: 'world' }));
      await expect(listSessionSnapshots()).resolves.toEqual([]);
    });

    it('skips malformed entries inside the array', async () => {
      await AsyncStorage.setItem(
        SESSION_SNAPSHOT_STORAGE_KEY,
        JSON.stringify([
          { id: 'snap_ok', exerciseKey: 'pullup', repCount: 5, startedAt: '2026-04-20T10:00:00Z', savedAt: '2026-04-20T10:05:00Z' },
          { wrong: true },
          null,
        ]),
      );
      const stored = await listSessionSnapshots();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('snap_ok');
    });
  });

  describe('deleteSessionSnapshot', () => {
    it('removes a matching record and returns true', async () => {
      const record = await saveSessionSnapshot(baseInput());
      await expect(deleteSessionSnapshot(record.id)).resolves.toBe(true);
      await expect(listSessionSnapshots()).resolves.toEqual([]);
    });

    it('returns false when the id is unknown', async () => {
      await saveSessionSnapshot(baseInput());
      await expect(deleteSessionSnapshot('snap_nope')).resolves.toBe(false);
      await expect(listSessionSnapshots()).resolves.toHaveLength(1);
    });
  });

  describe('clearSessionSnapshots', () => {
    it('nukes every stored record', async () => {
      await saveSessionSnapshot(baseInput());
      await saveSessionSnapshot({ ...baseInput(), exerciseKey: 'squat' });
      await clearSessionSnapshots();
      await expect(listSessionSnapshots()).resolves.toEqual([]);
    });
  });
});
