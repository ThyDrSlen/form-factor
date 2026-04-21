// Unit coverage for the pure helpers in ./translation.ts. The Deno handler in
// ./index.ts cannot be imported here (Deno-only URL imports), so we assert
// that the duplicated logic — which the handler calls — behaves correctly.

import {
  ALLOWED_MODELS,
  FALLBACK_MODEL,
  MAX_IMAGES_PER_REQUEST,
  VISION_CAPABLE_MODELS,
  buildGeminiPayload,
  buildGeminiUrl,
  buildSystemInstruction,
  countImageParts,
  extractGeminiText,
  isAllowedModel,
  resolveModel,
  sanitizeMessages,
  sanitizeName,
  stripImageParts,
  supportsVision,
  toGeminiContents,
  MAX_CONTENT_LENGTH,
  MAX_MESSAGES,
  type ChatMessage,
  type ContentPart,
} from './translation';

describe('coach-gemma translation helpers', () => {
  describe('toGeminiContents', () => {
    it('maps user -> user and assistant -> model', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hi coach' },
        { role: 'assistant', content: 'Ready when you are.' },
        { role: 'user', content: 'Squat tips?' },
      ];
      const contents = toGeminiContents(messages);
      expect(contents).toEqual([
        { role: 'user', parts: [{ text: 'Hi coach' }] },
        { role: 'model', parts: [{ text: 'Ready when you are.' }] },
        { role: 'user', parts: [{ text: 'Squat tips?' }] },
      ]);
    });

    it('merges system messages into the next user turn with [System]: prefix', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Be safe.' },
        { role: 'user', content: 'Hi' },
      ];
      const contents = toGeminiContents(messages);
      expect(contents).toEqual([
        { role: 'user', parts: [{ text: '[System]: Be safe.\n\nHi' }] },
      ]);
    });

    it('collects multiple system messages before the next user turn', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Be concise.' },
        { role: 'system', content: 'Avoid medical advice.' },
        { role: 'user', content: 'What about shoulder pain?' },
      ];
      const contents = toGeminiContents(messages);
      expect(contents[0].parts?.[0].text).toBe(
        '[System]: Be concise.\nAvoid medical advice.\n\nWhat about shoulder pain?',
      );
    });

    it('flushes a trailing system-only message as its own user turn', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hey' },
        { role: 'system', content: 'Remember to be brief.' },
      ];
      const contents = toGeminiContents(messages);
      expect(contents).toEqual([
        { role: 'user', parts: [{ text: 'Hey' }] },
        { role: 'user', parts: [{ text: '[System]: Remember to be brief.' }] },
      ]);
    });

    it('ignores empty system messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: '   ' },
        { role: 'user', content: 'Hi' },
      ];
      const contents = toGeminiContents(messages);
      expect(contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
    });
  });

  describe('buildSystemInstruction', () => {
    it('sanitizes names and uses them in the coaching line', () => {
      const instr = buildSystemInstruction({
        profile: { id: 'u1', name: 'Pat <script>' },
        focus: 'squat',
      });
      // `<`, `>`, `;` are stripped; internal whitespace is preserved.
      expect(instr).toContain('You are coaching Pat script.');
      expect(instr).toContain('Focus: squat.');
    });

    it('falls back to generic line when no name is supplied', () => {
      const instr = buildSystemInstruction({ focus: 'mobility' });
      expect(instr).toContain('You are coaching the user.');
      expect(instr).toContain('Focus: mobility.');
    });

    it('defaults focus to fitness_coach when missing', () => {
      const instr = buildSystemInstruction();
      expect(instr).toContain('Focus: fitness_coach.');
    });
  });

  describe('sanitizeName', () => {
    it('strips angle brackets and prompt-injection characters', () => {
      expect(sanitizeName('<Pat>')).toBe('Pat');
      expect(sanitizeName('Pat; DROP TABLE')).toBe('Pat DROP TABLE');
    });

    it('caps to 100 chars', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeName(long).length).toBeLessThanOrEqual(100);
    });
  });

  describe('sanitizeMessages', () => {
    it('drops entries missing required fields', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'valid' },
        { role: 'user' } as unknown as ChatMessage,
        { content: 'orphan' } as unknown as ChatMessage,
        null as unknown as ChatMessage,
      ];
      const out = sanitizeMessages(messages);
      expect(out).toHaveLength(1);
      expect(out[0].content).toBe('valid');
    });

    it('coerces unknown roles to user', () => {
      const messages = [
        { role: 'tool' as unknown as 'user', content: 'x' },
      ];
      const out = sanitizeMessages(messages as ChatMessage[]);
      expect(out[0].role).toBe('user');
    });

    it('truncates content to MAX_CONTENT_LENGTH', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'a'.repeat(MAX_CONTENT_LENGTH + 200) },
      ];
      const out = sanitizeMessages(messages);
      expect(out[0].content.length).toBe(MAX_CONTENT_LENGTH);
    });

    it('keeps only the most recent MAX_MESSAGES', () => {
      const messages: ChatMessage[] = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({
        role: 'user',
        content: `m${i}`,
      }));
      const out = sanitizeMessages(messages);
      expect(out).toHaveLength(MAX_MESSAGES);
      expect(out[out.length - 1].content).toBe(`m${MAX_MESSAGES + 4}`);
    });
  });

  describe('buildGeminiPayload', () => {
    it('wraps contents with systemInstruction and generationConfig', () => {
      const payload = buildGeminiPayload(
        [{ role: 'user', content: 'Hello' }],
        { focus: 'deadlift' },
        { temperature: 0.2, maxOutputTokens: 128 },
      );

      expect(payload.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
      ]);
      expect(payload.systemInstruction.parts[0].text).toContain('Focus: deadlift.');
      expect(payload.generationConfig).toEqual({
        temperature: 0.2,
        maxOutputTokens: 128,
      });
    });
  });

  describe('extractGeminiText', () => {
    it('pulls text from the first candidate, joining parts', () => {
      expect(
        extractGeminiText({
          candidates: [
            {
              content: {
                parts: [{ text: 'Brace your core' }, { text: ' and drive.' }],
              },
            },
          ],
        }),
      ).toBe('Brace your core and drive.');
    });

    it('returns null when parts are missing', () => {
      expect(extractGeminiText({ candidates: [{ content: {} }] })).toBeNull();
      expect(extractGeminiText({})).toBeNull();
    });

    it('returns null when the response was blocked', () => {
      expect(
        extractGeminiText({
          promptFeedback: { blockReason: 'SAFETY' },
          candidates: [
            { content: { parts: [{ text: 'should be ignored' }] } },
          ],
        }),
      ).toBeNull();
    });

    it('trims surrounding whitespace and returns null for empty strings', () => {
      expect(
        extractGeminiText({
          candidates: [{ content: { parts: [{ text: '   ' }] } }],
        }),
      ).toBeNull();
    });
  });

  describe('model allowlist', () => {
    it('includes only the three Gemma 3 instruct variants', () => {
      expect([...ALLOWED_MODELS].sort()).toEqual([
        'gemma-3-12b-it',
        'gemma-3-27b-it',
        'gemma-3-4b-it',
      ]);
      expect(FALLBACK_MODEL).toBe('gemma-3-4b-it');
    });

    it('isAllowedModel accepts valid models and rejects everything else', () => {
      expect(isAllowedModel('gemma-3-4b-it')).toBe(true);
      expect(isAllowedModel('gpt-4o')).toBe(false);
      expect(isAllowedModel('')).toBe(false);
      expect(isAllowedModel(undefined)).toBe(false);
      expect(isAllowedModel(null)).toBe(false);
      expect(isAllowedModel(42)).toBe(false);
    });

    it('resolveModel falls back on unknown input', () => {
      expect(resolveModel('gemma-3-27b-it')).toBe('gemma-3-27b-it');
      expect(resolveModel('unknown-model')).toBe(FALLBACK_MODEL);
      expect(resolveModel('')).toBe(FALLBACK_MODEL);
      expect(resolveModel(undefined)).toBe(FALLBACK_MODEL);
      expect(resolveModel('bad', 'gemma-3-12b-it')).toBe('gemma-3-12b-it');
    });
  });

  describe('buildGeminiUrl', () => {
    it('encodes the api key in the query string', () => {
      const url = buildGeminiUrl(
        'https://generativelanguage.googleapis.com/v1beta/models',
        'gemma-3-4b-it',
        'abc+/=special',
      );
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemma-3-4b-it:generateContent?key=abc%2B%2F%3Dspecial',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Multimodal extensions (#495)
  // ---------------------------------------------------------------------------

  describe('multimodal content parts', () => {
    const imgPart: ContentPart = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'IMG_B64' },
    };
    const textPart: ContentPart = { type: 'text', text: 'Critique my squat.' };

    describe('sanitizeMessages', () => {
      it('accepts a content-parts array on a valid message', () => {
        const out = sanitizeMessages([
          { role: 'user', content: [textPart, imgPart] },
        ]);
        expect(out).toHaveLength(1);
        expect(Array.isArray(out[0].content)).toBe(true);
      });

      it('drops content-parts that have an invalid shape', () => {
        const out = sanitizeMessages([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { role: 'user', content: [{ type: 'video', url: 'x' } as any] },
        ]);
        expect(out).toHaveLength(0);
      });

      it('drops messages where the image source is malformed', () => {
        const out = sanitizeMessages([
          {
            role: 'user',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: [{ type: 'image', source: { data: 'no-type' } } as any],
          },
        ]);
        expect(out).toHaveLength(0);
      });

      it('truncates text parts within content arrays', () => {
        const huge = 'a'.repeat(MAX_CONTENT_LENGTH + 100);
        const out = sanitizeMessages([
          { role: 'user', content: [{ type: 'text', text: huge }] },
        ]);
        const first = out[0].content as ContentPart[];
        expect((first[0] as { text: string }).text.length).toBe(
          MAX_CONTENT_LENGTH,
        );
      });

      it('preserves string-shape content for legacy callers', () => {
        const out = sanitizeMessages([{ role: 'user', content: 'Hello' }]);
        expect(out[0].content).toBe('Hello');
      });
    });

    describe('countImageParts', () => {
      it('counts images across messages', () => {
        expect(
          countImageParts([
            { role: 'user', content: [textPart, imgPart] },
            { role: 'user', content: [imgPart] },
          ]),
        ).toBe(2);
      });

      it('returns 0 for text-only messages', () => {
        expect(
          countImageParts([
            { role: 'user', content: 'hi' },
            { role: 'user', content: [textPart] },
          ]),
        ).toBe(0);
      });

      it('MAX_IMAGES_PER_REQUEST is the 1-per-request cap', () => {
        expect(MAX_IMAGES_PER_REQUEST).toBe(1);
      });
    });

    describe('stripImageParts', () => {
      it('removes image parts and preserves text content', () => {
        const out = stripImageParts([
          { role: 'user', content: [textPart, imgPart] },
        ]);
        expect(out).toEqual([
          { role: 'user', content: 'Critique my squat.' },
        ]);
      });

      it('drops a message that is image-only', () => {
        const out = stripImageParts([
          { role: 'user', content: [imgPart] },
          { role: 'user', content: 'kept' },
        ]);
        expect(out).toEqual([{ role: 'user', content: 'kept' }]);
      });

      it('passes through string-content messages untouched', () => {
        const legacy: ChatMessage = { role: 'user', content: 'legacy' };
        const out = stripImageParts([legacy]);
        expect(out[0]).toBe(legacy);
      });
    });

    describe('supportsVision / VISION_CAPABLE_MODELS', () => {
      it('accepts gemma-4 multimodal variants only', () => {
        expect(supportsVision('gemma-4-31b-it')).toBe(true);
        expect(supportsVision('gemma-4-26b-a4b-it')).toBe(true);
      });

      it('rejects every gemma-3-* variant and OpenAI models', () => {
        expect(supportsVision('gemma-3-4b-it')).toBe(false);
        expect(supportsVision('gemma-3-27b-it')).toBe(false);
        expect(supportsVision('gpt-5.4-mini')).toBe(false);
      });

      it('VISION_CAPABLE_MODELS is disjoint from ALLOWED_MODELS', () => {
        for (const m of VISION_CAPABLE_MODELS) {
          expect(ALLOWED_MODELS.has(m)).toBe(false);
        }
      });
    });

    describe('toGeminiContents with image parts', () => {
      it('emits inlineData for image parts alongside text', () => {
        const contents = toGeminiContents([
          { role: 'user', content: [textPart, imgPart] },
        ]);
        expect(contents).toHaveLength(1);
        const parts = contents[0].parts ?? [];
        expect(parts[0]).toEqual({ text: 'Critique my squat.' });
        expect(parts[1]).toEqual({
          inlineData: { mimeType: 'image/jpeg', data: 'IMG_B64' },
        });
      });

      it('joins multi-text parts with newlines before the image', () => {
        const contents = toGeminiContents([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'line one' },
              { type: 'text', text: 'line two' },
              imgPart,
            ],
          },
        ]);
        const parts = contents[0].parts ?? [];
        expect(parts[0]).toEqual({ text: 'line one\nline two' });
        expect(parts[1]).toEqual({
          inlineData: { mimeType: 'image/jpeg', data: 'IMG_B64' },
        });
      });

      it('still merges system-string messages with a subsequent multimodal user turn', () => {
        const contents = toGeminiContents([
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: [textPart, imgPart] },
        ]);
        const parts = contents[0].parts ?? [];
        expect((parts[0] as { text: string }).text).toContain('[System]: Be concise.');
        expect((parts[0] as { text: string }).text).toContain('Critique my squat.');
        expect(parts[1]).toEqual({
          inlineData: { mimeType: 'image/jpeg', data: 'IMG_B64' },
        });
      });
    });
  });
});
