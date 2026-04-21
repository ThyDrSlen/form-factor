/**
 * Tests for lib/services/voice-gemma-nlu-fallback.ts
 *
 * The fallback is exercised through both the prompt builder + parser
 * (pure, deterministic) and the dispatch shim `classifyViaGemma` with a
 * mocked sendPrompt.
 */

import {
  FALLBACK_CANDIDATES,
  GEMMA_FALLBACK_CONFIDENCE,
  buildGemmaNluPrompt,
  classifyViaGemma,
  parseGemmaNluResponse,
} from '@/lib/services/voice-gemma-nlu-fallback';
import type { CoachMessage } from '@/lib/services/coach-service';

describe('buildGemmaNluPrompt', () => {
  it('returns system + user message pair', () => {
    const messages = buildGemmaNluPrompt('skip the rest');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('includes every candidate intent in the prompt', () => {
    const prompt = buildGemmaNluPrompt('anything').map((m) => m.content).join('\n');
    for (const intent of FALLBACK_CANDIDATES) {
      expect(prompt).toContain(intent);
    }
  });

  it('quotes the transcript verbatim in the user turn', () => {
    const messages = buildGemmaNluPrompt('move to the next lift please');
    expect(messages[1].content).toContain('"move to the next lift please"');
  });
});

describe('parseGemmaNluResponse', () => {
  it.each(FALLBACK_CANDIDATES.map((i) => [i]))(
    "returns %s when Gemma replies with that token",
    (intent) => {
      expect(parseGemmaNluResponse(intent)).toBe(intent);
    },
  );

  it("returns 'none' when Gemma replies with 'none'", () => {
    expect(parseGemmaNluResponse('none')).toBe('none');
  });

  it('tolerates whitespace + punctuation', () => {
    expect(parseGemmaNluResponse('  pause.\n')).toBe('pause');
    expect(parseGemmaNluResponse('"resume"')).toBe('resume');
  });

  it("returns 'none' when Gemma hallucinates an unknown intent", () => {
    expect(parseGemmaNluResponse('dance')).toBe('none');
    expect(parseGemmaNluResponse('add_weight')).toBe('none'); // numeric intents excluded
  });

  it('returns \'none\' for empty / non-string input', () => {
    expect(parseGemmaNluResponse('')).toBe('none');
    // @ts-expect-error — intentional for defensive parse
    expect(parseGemmaNluResponse(null)).toBe('none');
  });
});

describe('classifyViaGemma', () => {
  it('returns the Gemma pick with pinned confidence on success', async () => {
    const sendPrompt = jest
      .fn<Promise<CoachMessage>, unknown[]>()
      .mockResolvedValue({ role: 'assistant', content: 'pause' });
    const result = await classifyViaGemma('wait up', sendPrompt);
    expect(result.intent).toBe('pause');
    expect(result.confidence).toBe(GEMMA_FALLBACK_CONFIDENCE);
    expect(result.normalized).toBe('wait up');
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  it("returns 'none' when Gemma picks 'none'", async () => {
    const sendPrompt = jest
      .fn<Promise<CoachMessage>, unknown[]>()
      .mockResolvedValue({ role: 'assistant', content: 'none' });
    const result = await classifyViaGemma('random noise', sendPrompt);
    expect(result.intent).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('collapses to none when sendPrompt throws (no crash)', async () => {
    const sendPrompt = jest
      .fn<Promise<CoachMessage>, unknown[]>()
      .mockRejectedValue(new Error('network down'));
    const result = await classifyViaGemma('pause now', sendPrompt);
    expect(result.intent).toBe('none');
  });

  it('routes through the Gemma provider hint', async () => {
    const sendPrompt = jest
      .fn<Promise<CoachMessage>, unknown[]>()
      .mockResolvedValue({ role: 'assistant', content: 'next' });
    await classifyViaGemma('keep going mate', sendPrompt);
    const opts = sendPrompt.mock.calls[0]?.[2] as { provider?: string } | undefined;
    expect(opts?.provider).toBe('gemma');
  });

  it('returns the inert default on empty transcript', async () => {
    const sendPrompt = jest.fn<Promise<CoachMessage>, unknown[]>();
    const result = await classifyViaGemma('   ', sendPrompt);
    expect(result.intent).toBe('none');
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
