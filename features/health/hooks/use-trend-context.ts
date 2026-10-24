import { useCallback, useEffect, useRef, useState } from 'react';
import { trendContextStorage } from '@/lib/services/healthkit/trend-context-storage';
import { type TrendContextAnnotation, type TrendContextDraft, validateTrendContext } from '@/lib/services/healthkit/trend-context';

type Store = typeof trendContextStorage;
type State = { epoch: number; annotations: TrendContextAnnotation[]; loading: boolean; saving: boolean; ready: boolean; error: string | null };

/** Explicit owner, no anonymous shared bucket. UI must also scope incoming health series. */
export function useTrendContext(ownerId: string | null | undefined, store: Store = trendContextStorage) {
  const owner = ownerId || null;
  const identity = useRef({ owner, store, epoch: 0 });
  if (identity.current.owner !== owner || identity.current.store !== store) {
    identity.current = { owner, store, epoch: identity.current.epoch + 1 };
  }
  const epoch = identity.current.epoch;
  const alive = useRef(false);
  const busy = useRef<number | null>(null);
  const [state, setState] = useState<State>({ epoch: -1, annotations: [], loading: true, saving: false, ready: false, error: null });
  const current = useCallback(() => alive.current && identity.current.epoch === epoch, [epoch]);
  const loadSequence = useRef(0);
  const readyEpoch = useRef<number | null>(null);
  const reload = useCallback(async () => {
    if (!current() || busy.current === epoch) return;
    const sequence = ++loadSequence.current;
    readyEpoch.current = null;
    setState({ epoch, annotations: [], loading: !!owner, saving: false, ready: false, error: null });
    if (!owner) return;
    try {
      const annotations = await store.load(owner);
      if (current() && sequence === loadSequence.current) {
        readyEpoch.current = epoch;
        setState({ epoch, annotations, loading: false, saving: false, ready: true, error: null });
      }
    } catch {
      if (current() && sequence === loadSequence.current) setState({ epoch, annotations: [], loading: false, saving: false, ready: false, error: 'Could not load local context. Retry before making changes.' });
    }
  }, [current, epoch, owner, store]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; };
  }, [reload]);
  const mutate = useCallback(async (operation: () => Promise<TrendContextAnnotation[]>): Promise<boolean> => {
    if (!owner || !current() || readyEpoch.current !== epoch || state.epoch !== epoch || !state.ready || busy.current === epoch) return false;
    busy.current = epoch;
    setState(previous => ({ ...previous, saving: true, error: null }));
    try {
      const annotations = await operation();
      if (!current()) return false;
      setState({ epoch, annotations, loading: false, saving: false, ready: true, error: null });
      return true;
    } catch {
      if (current()) setState(previous => ({ ...previous, saving: false, error: 'Could not save local context. Your saved annotations are unchanged; try again.' }));
      return false;
    } finally { if (busy.current === epoch) busy.current = null; }
  }, [current, epoch, owner, state.epoch, state.ready]);
  const add = useCallback(async (draft: TrendContextDraft) => {
    if (!current() || !owner) return false;
    try { validateTrendContext(draft); }
    catch (error) {
      setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Check the context fields.' }));
      return false;
    }
    return mutate(() => store.add(owner, draft));
  }, [current, mutate, owner, store]);
  const remove = useCallback((id: string) => mutate(() => store.remove(owner!, id)), [mutate, owner, store]);
  const visible = state.epoch === epoch && !!owner;
  return { annotations: visible ? state.annotations : [], loading: !!owner && (!visible || state.loading),
    saving: visible && state.saving, ready: visible && state.ready, error: visible ? state.error : null,
    add, remove, retry: reload };
}
