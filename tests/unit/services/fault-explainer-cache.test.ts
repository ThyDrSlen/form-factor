import { createCachingFaultExplainer } from '@/lib/services/fault-explainer-cache';
import type {
  FaultExplainer,
  FaultSynthesisInput,
  FaultSynthesisOutput,
} from '@/lib/services/fault-explainer';

function makeSpyRunner(counter: { calls: number }, overrides: Partial<FaultSynthesisOutput> = {}): FaultExplainer {
  return {
    async synthesize(input) {
      counter.calls += 1;
      return {
        synthesizedExplanation: `synthesis #${counter.calls} for ${input.faultIds.join(',')}`,
        primaryFaultId: input.faultIds[0] ?? null,
        rootCauseHypothesis: null,
        confidence: 0.8,
        source: 'gemma-local',
        ...overrides,
      };
    },
  };
}

const baseInput: FaultSynthesisInput = {
  exerciseId: 'squat',
  faultIds: ['shallow_depth', 'forward_lean', 'hip_shift'],
};

describe('createCachingFaultExplainer', () => {
  it('returns the inner result on cache miss', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    const out = await cached.synthesize(baseInput);
    expect(counter.calls).toBe(1);
    expect(out.synthesizedExplanation).toContain('synthesis #1');
    expect(cached.size()).toBe(1);
  });

  it('serves a cache hit without calling the inner runner', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize(baseInput);
    const second = await cached.synthesize(baseInput);
    expect(counter.calls).toBe(1);
    expect(second.synthesizedExplanation).toContain('synthesis #1');
  });

  it('treats fault-id order as equivalent', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize(baseInput);
    await cached.synthesize({
      exerciseId: 'squat',
      faultIds: ['hip_shift', 'forward_lean', 'shallow_depth'],
    });
    expect(counter.calls).toBe(1);
  });

  it('keys on exerciseId so squat vs pushup with the same fault ids miss separately', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize({ exerciseId: 'squat', faultIds: ['shallow_depth'] });
    await cached.synthesize({ exerciseId: 'pushup', faultIds: ['shallow_depth'] });
    expect(counter.calls).toBe(2);
  });

  it('invalidates when recent-history occurrence counts change', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize({
      ...baseInput,
      recentHistory: [
        { faultId: 'shallow_depth', occurrencesInLastNSessions: 2, sessionsSince: 0 },
      ],
    });
    await cached.synthesize({
      ...baseInput,
      recentHistory: [
        { faultId: 'shallow_depth', occurrencesInLastNSessions: 5, sessionsSince: 0 },
      ],
    });
    expect(counter.calls).toBe(2);
  });

  it('ignores sessionsSince (too noisy) when building the cache key', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize({
      ...baseInput,
      recentHistory: [
        { faultId: 'shallow_depth', occurrencesInLastNSessions: 2, sessionsSince: 0 },
      ],
    });
    await cached.synthesize({
      ...baseInput,
      recentHistory: [
        { faultId: 'shallow_depth', occurrencesInLastNSessions: 2, sessionsSince: 5 },
      ],
    });
    expect(counter.calls).toBe(1);
  });

  it('ignores setContext so rep/set/rpe variations hit the same key', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize({ ...baseInput, setContext: { repNumber: 1, setNumber: 1 } });
    await cached.synthesize({ ...baseInput, setContext: { repNumber: 8, setNumber: 3, rpe: 9 } });
    expect(counter.calls).toBe(1);
  });

  it('evicts least-recently-used entries when maxEntries is exceeded', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter), { maxEntries: 2 });
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'b', faultIds: ['x'] });
    expect(cached.size()).toBe(2);
    await cached.synthesize({ exerciseId: 'c', faultIds: ['x'] });
    expect(cached.size()).toBe(2);
    // 'a' should have been evicted; re-requesting it should miss.
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    expect(counter.calls).toBe(4);
  });

  it('refreshes LRU order on each hit', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter), { maxEntries: 2 });
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'b', faultIds: ['x'] });
    // Touch 'a' so it becomes most-recently-used
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    // Inserting 'c' should now evict 'b', not 'a'
    await cached.synthesize({ exerciseId: 'c', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    expect(counter.calls).toBe(3); // miss a, miss b, miss c, hit a twice
  });

  it('expires entries past the TTL', async () => {
    const counter = { calls: 0 };
    let fakeTime = 0;
    const cached = createCachingFaultExplainer(makeSpyRunner(counter), {
      ttlMs: 1000,
      now: () => fakeTime,
    });
    await cached.synthesize(baseInput);
    fakeTime = 500;
    await cached.synthesize(baseInput);
    expect(counter.calls).toBe(1);
    fakeTime = 1500;
    await cached.synthesize(baseInput);
    expect(counter.calls).toBe(2);
  });

  it('bypasses the cache for empty fault input', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize({ exerciseId: 'squat', faultIds: [] });
    await cached.synthesize({ exerciseId: 'squat', faultIds: [] });
    expect(counter.calls).toBe(2);
    expect(cached.size()).toBe(0);
  });

  it('clear() empties the cache', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize(baseInput);
    expect(cached.size()).toBe(1);
    cached.clear();
    expect(cached.size()).toBe(0);
    await cached.synthesize(baseInput);
    expect(counter.calls).toBe(2);
  });

  it('tracks hit/miss/eviction counters in stats()', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter), { maxEntries: 2 });
    expect(cached.stats()).toEqual({ hits: 0, misses: 0, evictions: 0, size: 0 });

    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'a', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'b', faultIds: ['x'] });
    await cached.synthesize({ exerciseId: 'c', faultIds: ['x'] });

    const s = cached.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(3);
    expect(s.evictions).toBe(1);
    expect(s.size).toBe(2);
  });

  it('resets counters on clear()', async () => {
    const counter = { calls: 0 };
    const cached = createCachingFaultExplainer(makeSpyRunner(counter));
    await cached.synthesize(baseInput);
    await cached.synthesize(baseInput);
    cached.clear();
    expect(cached.stats()).toEqual({ hits: 0, misses: 0, evictions: 0, size: 0 });
  });

  it('propagates errors from the inner runner without caching them', async () => {
    let attempts = 0;
    const flaky: FaultExplainer = {
      async synthesize() {
        attempts += 1;
        throw new Error('boom');
      },
    };
    const cached = createCachingFaultExplainer(flaky);
    await expect(cached.synthesize(baseInput)).rejects.toThrow('boom');
    await expect(cached.synthesize(baseInput)).rejects.toThrow('boom');
    expect(attempts).toBe(2);
    expect(cached.size()).toBe(0);
  });
});
