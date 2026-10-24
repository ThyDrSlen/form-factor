import { createTrendContextStorage, trendContextStorageKey } from '@/lib/services/healthkit/trend-context-storage';

const draft = { kind: 'Travel' as const, startDate: '2020-01-01', endDate: '2020-01-03' };
function fixture() {
  const values = new Map<string, string>();
  const io = { getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }) };
  return { values, io, store: createTrendContextStorage(io) };
}
describe('account-local annotations', () => {
  it('adds/deletes durably only within the explicit owner and serializes overlapping writes', async () => {
    const { store, values } = fixture();
    const [first] = await Promise.all([store.add('a', draft), store.add('a', { ...draft, kind: 'Illness' })]);
    expect(await store.load('a')).toHaveLength(2);
    expect(await store.load('b')).toEqual([]);
    await store.remove('a', first[0].id);
    expect((await store.load('a'))[0].kind).toBe('Illness');
    expect(values.has(trendContextStorageKey('b'))).toBe(false);
    await expect(store.add('', draft)).rejects.toThrow(/account/i);
  });
  it('does not overwrite unavailable or corrupt storage', async () => {
    const { store, io, values } = fixture();
    io.getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(store.add('a', draft)).rejects.toThrow();
    expect(io.setItem).not.toHaveBeenCalled();
    values.set(trendContextStorageKey('a'), 'bad-json');
    await expect(store.add('a', draft)).rejects.toThrow();
    expect(io.setItem).not.toHaveBeenCalled();
    values.set(trendContextStorageKey('a'), JSON.stringify({ version: 1, ownerId: 'b', annotations: [] }));
    await expect(store.load('a')).rejects.toThrow();
  });
  it('reports save failure without poisoning future retries or deleting saved data', async () => {
    const { store, io } = fixture();
    const saved = await store.add('a', draft);
    io.setItem.mockRejectedValueOnce(new Error('full'));
    await expect(store.remove('a', saved[0].id)).rejects.toThrow('full');
    expect(await store.load('a')).toEqual(saved);
    await store.remove('a', saved[0].id);
    expect(await store.load('a')).toEqual([]);
  });
});
