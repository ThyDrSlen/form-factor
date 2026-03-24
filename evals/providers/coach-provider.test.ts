// @ts-nocheck — .mjs provider has no type declarations
/* eslint-disable @typescript-eslint/no-explicit-any */
import CoachProvider, {
  sanitizeMessages,
  sanitizeName,
  buildPrompt,
} from './coach-provider.mjs';

const OPENAI_SUCCESS_RESPONSE = {
  choices: [
    {
      message: {
        content: 'Try 3 sets of 10 goblet squats with 30s rest.',
      },
    },
  ],
  usage: {
    total_tokens: 150,
    prompt_tokens: 100,
    completion_tokens: 50,
  },
};

function mockFetchSuccess(body = OPENAI_SUCCESS_RESPONSE, status = 200) {
  const fn = jest.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
  globalThis.fetch = fn as any;
  return fn;
}

function mockFetchFailure(status = 500, body: any = 'Internal Server Error') {
  const fn = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve(body),
      text: () =>
        Promise.resolve(
          typeof body === 'string' ? body : JSON.stringify(body),
        ),
    }),
  );
  globalThis.fetch = fn as any;
  return fn;
}

describe('sanitizeName', () => {
  test('strips control characters and prompt delimiters', () => {
    expect(sanitizeName('John<script>alert(1)</script>')).toBe(
      'Johnscriptalert1script',
    );
  });

  test('preserves valid characters: letters, spaces, hyphens, apostrophes', () => {
    expect(sanitizeName("Mary-Jane O'Brien")).toBe("Mary-Jane O'Brien");
  });

  test('caps length at 100 characters', () => {
    const longName = 'A'.repeat(150);
    expect(sanitizeName(longName).length).toBe(100);
  });

  test('trims whitespace', () => {
    expect(sanitizeName('  John  ')).toBe('John');
  });
});

describe('sanitizeMessages', () => {
  test('filters out messages without string content', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 123 },
      { role: 'user', content: null },
      { role: 'user' },
    ];
    expect(sanitizeMessages(messages)).toHaveLength(1);
  });

  test('filters out messages without string role', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 123, content: 'world' },
      { content: 'no role' },
    ];
    expect(sanitizeMessages(messages)).toHaveLength(1);
  });

  test('normalises unknown roles to user', () => {
    const messages = [{ role: 'admin', content: 'hello' }];
    expect(sanitizeMessages(messages)[0].role).toBe('user');
  });

  test('preserves valid roles: user, assistant, system', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'system', content: 'c' },
    ];
    const result = sanitizeMessages(messages);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('system');
  });

  test('truncates content to 1200 characters', () => {
    const messages = [{ role: 'user', content: 'X'.repeat(2000) }];
    expect(sanitizeMessages(messages)[0].content.length).toBe(1200);
  });

  test('keeps only last 12 messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user',
      content: `msg ${i}`,
    }));
    const result = sanitizeMessages(messages);
    expect(result).toHaveLength(12);
    expect(result[0].content).toBe('msg 8');
    expect(result[11].content).toBe('msg 19');
  });

  test('returns empty array for undefined input', () => {
    expect(sanitizeMessages()).toEqual([]);
  });
});

describe('buildPrompt', () => {
  test('contains all 7 system prompt clauses', () => {
    const result = buildPrompt({});
    const content = result[0].content;

    expect(content).toContain(
      'You are Form Factor\u2019s AI coach for strength, conditioning, mobility, and nutrition.',
    );
    expect(content).toContain('You are coaching the user.');
    expect(content).toContain(
      'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
    );
    expect(content).toContain(
      'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
    );
    expect(content).toContain(
      'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
    );
    expect(content).toContain('Offer 1-2 options max; avoid long lists.');
    expect(content).toContain(
      'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
    );
  });

  test('uses default focus fitness_coach when not provided', () => {
    const result = buildPrompt({});
    expect(result[0].content).toContain('Focus: fitness_coach.');
  });

  test('uses provided focus', () => {
    const result = buildPrompt({ focus: 'nutrition' });
    expect(result[0].content).toContain('Focus: nutrition.');
  });

  test('uses user_name when provided', () => {
    const result = buildPrompt({ user_name: 'Alice' });
    expect(result[0].content).toContain('You are coaching Alice.');
  });

  test('sanitises user_name against injection', () => {
    const result = buildPrompt({ user_name: 'Bob<script>' });
    expect(result[0].content).toContain('You are coaching Bobscript.');
    expect(result[0].content).not.toContain('<script>');
  });

  test('uses fallback when user_name is empty string', () => {
    const result = buildPrompt({ user_name: '' });
    expect(result[0].content).toContain('You are coaching the user.');
  });

  test('returns exactly one system-role message', () => {
    const result = buildPrompt({});
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
  });
});

describe('CoachProvider', () => {
  let provider: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    provider = new CoachProvider();
    process.env.OPENAI_API_KEY = 'test-api-key';
    delete process.env.COACH_MODEL;
    delete process.env.COACH_TEMPERATURE;
    delete process.env.COACH_MAX_TOKENS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

test('id() includes model name', () => {
expect(provider.id()).toBe('form-factor-coach:gpt-5.4-mini');
  });

  test('returns error when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await provider.callApi('hello', { vars: {} });
    expect(result.error).toContain('OPENAI_API_KEY');
  });

  test('calls OpenAI with correct payload and defaults', async () => {
    const fetchMock = mockFetchSuccess();

    await provider.callApi('How do I do a pull-up?', {
      vars: { user_name: 'Alice', focus: 'strength' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-api-key');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.temperature).toBe(0.6);
    expect(body.max_completion_tokens).toBe(320);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('You are coaching Alice.');
    expect(body.messages[0].content).toContain('Focus: strength.');
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'How do I do a pull-up?',
    });
  });

  test('returns output and tokenUsage on success', async () => {
    mockFetchSuccess();

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.output).toBe(
      'Try 3 sets of 10 goblet squats with 30s rest.',
    );
    expect(result.tokenUsage).toEqual({
      total: 150,
      prompt: 100,
      completion: 50,
    });
  });

  test('respects COACH_MODEL env var', async () => {
    process.env.COACH_MODEL = 'gpt-4o';
    const fetchMock = mockFetchSuccess();

    await provider.callApi('hello', { vars: {} });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o');
  });

  test('respects COACH_TEMPERATURE env var', async () => {
    process.env.COACH_TEMPERATURE = '0.9';
    const fetchMock = mockFetchSuccess();

    await provider.callApi('hello', { vars: {} });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.9);
  });

  test('respects COACH_MAX_TOKENS env var', async () => {
    process.env.COACH_MAX_TOKENS = '500';
    const fetchMock = mockFetchSuccess();

    await provider.callApi('hello', { vars: {} });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(500);
  });

  test('returns error on non-OK response', async () => {
    mockFetchFailure(429, 'Rate limited');

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.error).toContain('429');
    expect(result.error).toContain('Rate limited');
  });

  test('returns error on invalid JSON response', async () => {
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => {
          throw new Error('Invalid JSON');
        },
      }),
    ) as any;

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.error).toContain('Failed to parse');
  });

  test('returns error on unexpected response structure (empty choices)', async () => {
    mockFetchSuccess({ choices: [] });

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.error).toContain('Unexpected');
  });

  test('returns error on empty response content', async () => {
    mockFetchSuccess({
      choices: [{ message: { content: '   ' } }],
      usage: { total_tokens: 10, prompt_tokens: 5, completion_tokens: 5 },
    });

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.error).toContain('Empty');
  });

  test('handles missing usage data gracefully', async () => {
    mockFetchSuccess({
      choices: [{ message: { content: 'Do squats' } }],
    });

    const result = await provider.callApi('hello', { vars: {} });

    expect(result.output).toBe('Do squats');
    expect(result.tokenUsage).toEqual({ total: 0, prompt: 0, completion: 0 });
  });

  test('handles missing context.vars gracefully', async () => {
    mockFetchSuccess();

    const result = await provider.callApi('hello', {});

    expect(result.output).toBeDefined();
  });

  test('handles undefined context gracefully', async () => {
    mockFetchSuccess();

    const result = await provider.callApi('hello', undefined);

    expect(result.output).toBeDefined();
  });
});
