import {
  ALLOWED_MODELS,
  FALLBACK_MODEL,
  RATE_LIMIT_WINDOW_MS,
  type ChatMessage,
  buildPrompt,
  checkRateLimit,
  isOpenAIResponse,
  sanitizeMessages,
  sanitizeName,
  validateModel,
} from '@/supabase/functions/coach/validation';

describe('coach validation helpers', () => {
  describe('sanitizeMessages', () => {
    it('filters invalid messages, normalizes roles, trims content, and keeps the newest 12', () => {
      const longContent = 'x'.repeat(1300);
      const messages = [
        { role: 'user', content: 'keep-1' },
        { role: 'assistant', content: 'keep-2' },
        { role: 'bogus', content: longContent },
        { role: 'user', content: 42 },
        ...Array.from({ length: 12 }, (_, index) => ({ role: 'user', content: `recent-${index}` })),
      ] as unknown as ChatMessage[];

      const result = sanitizeMessages(messages);

      expect(result).toHaveLength(12);
      expect(result[0].content).toBe('recent-0');
      expect(result.at(-1)?.content).toBe('recent-11');
      expect(result.some((message) => message.content.length > 1200)).toBe(false);
    });

    it('falls back invalid roles to user before slicing', () => {
      const result = sanitizeMessages([{ role: 'bad-role' as never, content: 'hello' }]);

      expect(result).toEqual([{ role: 'user', content: 'hello' }]);
    });
  });

  describe('sanitizeName', () => {
    it('removes unsafe characters and truncates names', () => {
      const dirtyName = `${'A'.repeat(120)}<script>alert(1)</script>!`;

      expect(sanitizeName(dirtyName)).toBe('A'.repeat(100));
    });
  });

  describe('buildPrompt', () => {
    it('builds a system prompt with sanitized name and focus', () => {
      const [prompt] = buildPrompt({
        profile: { name: 'Sam <b>Strong</b>' },
        focus: 'mobility',
      });

      expect(prompt.role).toBe('system');
      expect(prompt.content).toContain('You are coaching Sam bStrongb.');
      expect(prompt.content).toContain('Focus: mobility.');
    });
  });

  describe('checkRateLimit', () => {
    it('allows the first 20 requests in a window and blocks the 21st', () => {
      const limits = new Map<string, { count: number; windowStart: number }>();
      const userId = 'user-123';
      const start = 1_000;

      for (let count = 0; count < 20; count += 1) {
        expect(checkRateLimit(userId, limits, start + count)).toEqual({ allowed: true });
      }

      expect(checkRateLimit(userId, limits, start + 21)).toEqual({
        allowed: false,
        retryAfter: 60,
      });
    });

    it('resets the window after one minute elapses', () => {
      const limits = new Map<string, { count: number; windowStart: number }>();
      const userId = 'user-123';
      const start = 5_000;

      for (let count = 0; count < 20; count += 1) {
        checkRateLimit(userId, limits, start + count);
      }

      expect(checkRateLimit(userId, limits, start + RATE_LIMIT_WINDOW_MS + 1)).toEqual({
        allowed: true,
      });
    });
  });

  describe('validateModel', () => {
    it('keeps allowed models unchanged', () => {
      for (const model of ALLOWED_MODELS) {
        expect(validateModel(model)).toBe(model);
      }
    });

    it('falls back for invalid models', () => {
      expect(validateModel('gpt-5.4-mini')).toBe(FALLBACK_MODEL);
    });
  });

  describe('isOpenAIResponse', () => {
    it('accepts shaped OpenAI responses and rejects invalid values', () => {
      expect(isOpenAIResponse({ choices: [{ message: { content: 'Hello' } }] })).toBe(true);
      expect(isOpenAIResponse({ choices: 'bad' })).toBe(false);
      expect(isOpenAIResponse(null)).toBe(false);
    });
  });
});
