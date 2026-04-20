import {
  parseGemmaJsonResponse,
  stripJsonFences,
  schema,
  GemmaJsonParseError,
} from '@/lib/services/gemma-json-parser';

describe('stripJsonFences', () => {
  it('returns raw input when no fences', () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it('strips bare ``` fences', () => {
    const input = '```\n{"a":1}\n```';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it('extracts JSON object after leading prose', () => {
    const input = 'Here is the workout:\n{"a":1}';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it('trims trailing prose after JSON close', () => {
    const input = '{"a":1}\n\nHope this helps!';
    expect(stripJsonFences(input)).toBe('{"a":1}');
  });

  it('extracts JSON array over JSON object when array comes first', () => {
    const input = '[1,2,3]';
    expect(stripJsonFences(input)).toBe('[1,2,3]');
  });

  it('handles nested braces correctly', () => {
    const input = '{"a":{"b":{"c":1}},"d":2}';
    expect(stripJsonFences(input)).toBe('{"a":{"b":{"c":1}},"d":2}');
  });

  it('handles braces inside strings', () => {
    const input = '{"a":"{nope}","b":1}';
    expect(stripJsonFences(input)).toBe('{"a":"{nope}","b":1}');
  });
});

describe('schema primitives', () => {
  it('string rejects non-string and enforces minLength', () => {
    expect(schema.string().validate(123).ok).toBe(false);
    expect(schema.string({ minLength: 3 }).validate('ab').ok).toBe(false);
    expect(schema.string({ minLength: 3 }).validate('abc').ok).toBe(true);
  });

  it('number enforces integer and range', () => {
    expect(schema.number({ integer: true }).validate(1.5).ok).toBe(false);
    expect(schema.number({ min: 5, max: 10 }).validate(4).ok).toBe(false);
    expect(schema.number({ min: 5, max: 10 }).validate(7).ok).toBe(true);
  });

  it('enumOf rejects unknown values', () => {
    const s = schema.enumOf(['a', 'b'] as const);
    expect(s.validate('c').ok).toBe(false);
    expect(s.validate('a').ok).toBe(true);
  });

  it('array enforces min/max length and element shape', () => {
    const s = schema.array(schema.string(), { minLength: 1, maxLength: 3 });
    expect(s.validate([]).ok).toBe(false);
    expect(s.validate(['a', 'b', 'c', 'd']).ok).toBe(false);
    expect(s.validate(['a', 1 as unknown as string]).ok).toBe(false);
    const r = s.validate(['a']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(['a']);
  });

  it('object validates required keys and aggregates issues', () => {
    const s = schema.object({ name: schema.string(), age: schema.number() });
    const r = s.validate({ name: 5, age: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBe(2);
  });

  it('optional passes undefined through', () => {
    const s = schema.object({ n: schema.optional(schema.string()) });
    const r = s.validate({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.n).toBeUndefined();
  });

  it('nullable accepts null explicitly', () => {
    const s = schema.nullable(schema.number());
    expect(s.validate(null).ok).toBe(true);
    expect(s.validate(5).ok).toBe(true);
    expect(s.validate('x').ok).toBe(false);
  });
});

describe('parseGemmaJsonResponse — happy paths', () => {
  const workoutShape = schema.object({
    name: schema.string(),
    exercises: schema.array(schema.string(), { minLength: 1 }),
  });

  it('parses plain JSON and validates shape', async () => {
    const raw = '{"name":"Push Day","exercises":["pushup","bench"]}';
    const result = await parseGemmaJsonResponse(raw, workoutShape);
    expect(result.name).toBe('Push Day');
    expect(result.exercises).toEqual(['pushup', 'bench']);
  });

  it('strips fences and parses', async () => {
    const raw = '```json\n{"name":"Pull Day","exercises":["pullup"]}\n```';
    const result = await parseGemmaJsonResponse(raw, workoutShape);
    expect(result.name).toBe('Pull Day');
  });

  it('recovers from trailing prose', async () => {
    const raw = '{"name":"X","exercises":["y"]}\n\nThanks!';
    const result = await parseGemmaJsonResponse(raw, workoutShape);
    expect(result.exercises).toEqual(['y']);
  });
});

describe('parseGemmaJsonResponse — error paths', () => {
  const intShape = schema.object({ n: schema.number({ integer: true }) });

  it('throws GEMMA_JSON_SYNTAX on malformed JSON with no retry', async () => {
    await expect(parseGemmaJsonResponse('{not json', intShape)).rejects.toMatchObject({
      code: 'GEMMA_JSON_SYNTAX',
    });
  });

  it('throws GEMMA_JSON_SHAPE on validation failure with no retry', async () => {
    await expect(parseGemmaJsonResponse('{"n":1.5}', intShape)).rejects.toMatchObject({
      code: 'GEMMA_JSON_SHAPE',
    });
  });

  it('retries via callback and succeeds on subsequent attempt', async () => {
    const retry = jest.fn().mockResolvedValueOnce('{"n":7}');
    const result = await parseGemmaJsonResponse('{"n":"bad"}', intShape, { maxRetries: 1, retry });
    expect(result.n).toBe(7);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0].issues).toBeDefined();
  });

  it('exhausts retries and throws GEMMA_JSON_RETRY_EXHAUSTED', async () => {
    const retry = jest.fn().mockResolvedValue('{still bad');
    await expect(
      parseGemmaJsonResponse('{initial bad', intShape, { maxRetries: 2, retry }),
    ).rejects.toMatchObject({
      code: 'GEMMA_JSON_RETRY_EXHAUSTED',
      attempts: 3,
    });
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('retries for shape failures just like syntax failures', async () => {
    const retry = jest
      .fn()
      .mockResolvedValueOnce('{"n":1.5}') // still bad shape
      .mockResolvedValueOnce('{"n":3}'); // good
    const result = await parseGemmaJsonResponse('{"n":"bad"}', intShape, { maxRetries: 2, retry });
    expect(result.n).toBe(3);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('GemmaJsonParseError carries raw text snippet and issues', async () => {
    try {
      await parseGemmaJsonResponse('{"n":1.5}', intShape);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GemmaJsonParseError);
      const ge = err as GemmaJsonParseError;
      expect(ge.appError.domain).toBe('validation');
      expect(ge.issues?.length).toBeGreaterThan(0);
      expect(ge.rawText).toContain('1.5');
    }
  });
});
