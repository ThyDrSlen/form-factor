import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateTrendContext, type TrendContextAnnotation, type TrendContextDraft } from './trend-context';

export function trendContextStorageKey(ownerId: string): string {
  if (!ownerId.trim()) throw new Error('An account is required.');
  return `health_trend_context_v1:${encodeURIComponent(ownerId)}`;
}

type StorageIO = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
export function createTrendContextStorage(io: StorageIO) {
  const queues = new Map<string, Promise<unknown>>();
  async function read(ownerId: string): Promise<TrendContextAnnotation[]> {
    const raw = await io.getItem(trendContextStorageKey(ownerId));
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || parsed.ownerId !== ownerId || !Array.isArray(parsed.annotations)) {
      throw new Error('Local context could not be read safely.');
    }
    const ids = new Set<string>();
    return parsed.annotations.map((row: TrendContextAnnotation) => {
      if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('Invalid local context.');
      ids.add(row.id);
      return { ...validateTrendContext(row), id: row.id };
    });
  }
  async function mutate(ownerId: string, change: (rows: TrendContextAnnotation[]) => TrendContextAnnotation[]) {
    trendContextStorageKey(ownerId);
    const previous = queues.get(ownerId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const next = change(await read(ownerId));
      await io.setItem(trendContextStorageKey(ownerId), JSON.stringify({ version: 1, ownerId, annotations: next }));
      return next;
    });
    queues.set(ownerId, operation);
    try { return await operation; }
    finally { if (queues.get(ownerId) === operation) queues.delete(ownerId); }
  }
  return {
    async load(ownerId: string) {
      await queues.get(ownerId)?.catch(() => undefined);
      return read(ownerId);
    },
    async add(ownerId: string, draft: TrendContextDraft) {
      const valid = validateTrendContext(draft);
      return mutate(ownerId, rows => {
        // The owner queue serializes allocation; collisions are checked against saved IDs.
        const base = Date.now().toString(36);
        let suffix = 0;
        while (rows.some(row => row.id === `${base}-${suffix}`)) suffix++;
        return [...rows, { ...valid, id: `${base}-${suffix}` }];
      });
    },
    remove(ownerId: string, id: string) { return mutate(ownerId, rows => rows.filter(row => row.id !== id)); },
  };
}
export const trendContextStorage = createTrendContextStorage(AsyncStorage);
