/**
 * Tests for the Gemma NLU fallback branch added to
 * `classifyIntentWithFallback` in lib/services/voice-intent-classifier.ts.
 *
 * The sync `classifyIntent` stays untouched; here we drive the async
 * variant with a mocked Gemma dispatcher so we can assert the exact
 * upgrade-on-low-confidence contract without touching the network.
 */

import {
  CONFIDENCE_THRESHOLD,
  classifyIntent,
  classifyIntentWithFallback,
  type ClassifiedIntent,
} from '@/lib/services/voice-intent-classifier';

describe('classifyIntentWithFallback', () => {
  it('returns the regex match untouched when the primary is above threshold', async () => {
    const sendGemmaPrompt = jest.fn<Promise<ClassifiedIntent>, [string]>();
    const result = await classifyIntentWithFallback('hey form pause', {
      isPipelineEnabled: () => true,
      sendGemmaPrompt,
    });
    expect(result.intent).toBe('pause');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
    expect(sendGemmaPrompt).not.toHaveBeenCalled();
  });

  it('skips the fallback when the pipeline flag is off', async () => {
    const sendGemmaPrompt = jest.fn<Promise<ClassifiedIntent>, [string]>();
    const result = await classifyIntentWithFallback('blargh', {
      isPipelineEnabled: () => false,
      sendGemmaPrompt,
    });
    expect(result.intent).toBe('none');
    expect(sendGemmaPrompt).not.toHaveBeenCalled();
  });

  it('upgrades a low-confidence regex miss with the Gemma pick', async () => {
    // "I would like to move along" — outside the regex patterns
    const primary = classifyIntent('hey form i would like to move along');
    expect(primary.intent).toBe('none');

    const sendGemmaPrompt = jest
      .fn<Promise<ClassifiedIntent>, [string]>()
      .mockResolvedValue({
        intent: 'next',
        params: {},
        confidence: 0.8,
        normalized: 'i would like to move along',
      });
    const result = await classifyIntentWithFallback(
      'hey form i would like to move along',
      {
        isPipelineEnabled: () => true,
        sendGemmaPrompt,
      },
    );
    expect(result.intent).toBe('next');
    expect(result.confidence).toBe(0.8);
    expect(sendGemmaPrompt).toHaveBeenCalledTimes(1);
  });

  it('keeps the primary result when Gemma also returns none', async () => {
    const sendGemmaPrompt = jest
      .fn<Promise<ClassifiedIntent>, [string]>()
      .mockResolvedValue({
        intent: 'none',
        params: {},
        confidence: 0,
        normalized: 'gibberish',
      });
    const result = await classifyIntentWithFallback('hey form gibberish', {
      isPipelineEnabled: () => true,
      sendGemmaPrompt,
    });
    expect(result.intent).toBe('none');
  });

  it('rejects a Gemma pick whose confidence is below threshold', async () => {
    const sendGemmaPrompt = jest
      .fn<Promise<ClassifiedIntent>, [string]>()
      .mockResolvedValue({
        intent: 'resume',
        params: {},
        confidence: 0.6,
        normalized: 'keep on it',
      });
    const result = await classifyIntentWithFallback('hey form keep on it', {
      isPipelineEnabled: () => true,
      sendGemmaPrompt,
    });
    // Below threshold → fall back to the primary 'none'.
    expect(result.intent).toBe('none');
  });
});
