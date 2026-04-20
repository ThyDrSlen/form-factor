import {
  getFewShots,
  getAllFewShots,
  type FewShotDomain,
} from '@/lib/services/template-generation-few-shots';

describe('template-generation-few-shots', () => {
  const domains: FewShotDomain[] = ['session', 'warmup', 'cooldown', 'rest'];

  describe.each(domains)('domain = %s', (domain) => {
    it('returns at least one example for default query', () => {
      const examples = getFewShots({ domain });
      expect(examples.length).toBeGreaterThan(0);
    });

    it('returns examples with non-empty prompt + response', () => {
      const examples = getAllFewShots(domain);
      expect(examples.length).toBeGreaterThanOrEqual(3);
      for (const ex of examples) {
        expect(typeof ex.prompt).toBe('string');
        expect(ex.prompt.length).toBeGreaterThan(0);
        expect(typeof ex.response).toBe('string');
        expect(ex.response.length).toBeGreaterThan(0);
      }
    });

    it('each example response parses as valid JSON', () => {
      const examples = getAllFewShots(domain);
      for (const ex of examples) {
        expect(() => JSON.parse(ex.response)).not.toThrow();
      }
    });

    it('respects limit parameter', () => {
      const examples = getFewShots({ domain, limit: 1 });
      expect(examples.length).toBe(1);
    });
  });

  it('prefers examples matching goalProfile when specified', () => {
    const examples = getFewShots({ domain: 'session', goalProfile: 'strength', limit: 1 });
    expect(examples[0].goalProfile).toBe('strength');
  });

  it('prefers examples near the requested durationMin', () => {
    const examples = getFewShots({ domain: 'session', durationMin: 15, limit: 1 });
    // Closest example is the 15-min quick-push
    expect(examples[0].durationMin).toBe(15);
  });

  it('falls back to pool when filters match nothing', () => {
    const examples = getFewShots({ domain: 'rest', goalProfile: 'power', limit: 2 });
    expect(examples.length).toBe(2);
  });

  it('returns empty array via getAllFewShots on unknown domain cast', () => {
    const examples = getAllFewShots('bogus' as FewShotDomain);
    expect(examples).toEqual([]);
  });
});
