import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useTrendContext } from '@/features/health/hooks/use-trend-context';
import type { TrendContextAnnotation } from '@/lib/services/healthkit/trend-context';

const row: TrendContextAnnotation = { id: 'one', kind: 'Travel', startDate: '2020-01-01', endDate: '2020-01-02', city: 'Private city' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function storeMock() { return { load: jest.fn(async (_owner: string) => [] as TrendContextAnnotation[]), add: jest.fn(async () => [row]), remove: jest.fn(async () => [] as TrendContextAnnotation[]) }; }
describe('useTrendContext ownership and durability', () => {
  it('does not let an older retry overwrite newer loaded annotations', async () => {
    const older = deferred<TrendContextAnnotation[]>(); const store = storeMock();
    store.load.mockReturnValueOnce(older.promise).mockResolvedValueOnce([row]);
    const { result } = renderHook(() => useTrendContext('a', store));
    await act(async () => { await result.current.retry(); });
    expect(result.current.annotations).toEqual([row]);
    await act(async () => { older.resolve([]); });
    expect(result.current.annotations).toEqual([row]);
  });
  it('blocks a retained add callback while a retry is loading', async () => {
    const store = storeMock();
    const { result } = renderHook(() => useTrendContext('a', store));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const oldAdd = result.current.add;
    const pending = deferred<TrendContextAnnotation[]>(); store.load.mockReturnValueOnce(pending.promise);
    let retry!: Promise<void>;
    act(() => { retry = result.current.retry(); });
    await act(async () => { expect(await oldAdd(row)).toBe(false); });
    expect(store.add).not.toHaveBeenCalled();
    await act(async () => { pending.resolve([]); await retry; });
  });
  it('ignores a late load after account switch and hides data on logout', async () => {
    const a = deferred<TrendContextAnnotation[]>(); const store = storeMock();
    store.load.mockImplementation(owner => owner === 'a' ? a.promise : Promise.resolve([]));
    const { result, rerender } = renderHook(({ owner }: { owner: string | null }) => useTrendContext(owner, store), { initialProps: { owner: 'a' as string | null } });
    rerender({ owner: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { a.resolve([row]); });
    expect(result.current.annotations).toEqual([]);
    rerender({ owner: null });
    expect(result.current.annotations).toEqual([]);
    await act(async () => { expect(await result.current.add(row)).toBe(false); });
    expect(store.add).not.toHaveBeenCalled();
  });
  it('prevents stale mutation completion and callbacks from changing the next owner', async () => {
    const save = deferred<TrendContextAnnotation[]>(); const store = storeMock(); store.add.mockReturnValue(save.promise);
    const { result, rerender } = renderHook(({ owner }: { owner: string }) => useTrendContext(owner, store), { initialProps: { owner: 'a' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldAdd = result.current.add;
    let pending!: Promise<boolean>;
    act(() => { pending = oldAdd(row); });
    rerender({ owner: 'b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { save.resolve([row]); expect(await pending).toBe(false); expect(await oldAdd(row)).toBe(false); });
    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.add).toHaveBeenCalledWith('a', row);
    expect(result.current.annotations).toEqual([]);
  });
  it('blocks edits after load failure until retry and retains records on failed save', async () => {
    const store = storeMock(); store.load.mockRejectedValueOnce(new Error('disk'));
    const { result } = renderHook(() => useTrendContext('a', store));
    await waitFor(() => expect(result.current.error).toMatch(/load/i));
    await act(async () => { expect(await result.current.add(row)).toBe(false); });
    expect(store.add).not.toHaveBeenCalled();
    await act(async () => { await result.current.retry(); });
    await act(async () => { expect(await result.current.add(row)).toBe(true); });
    store.remove.mockRejectedValueOnce(new Error('disk'));
    await act(async () => { expect(await result.current.remove(row.id)).toBe(false); });
    expect(result.current.annotations).toEqual([row]);
    expect(result.current.error).toMatch(/save/i);
  });
});
