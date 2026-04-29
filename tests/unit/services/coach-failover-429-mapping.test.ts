// Regression tests for coach-failover 429 friendly-message mapping (wave-31).
//
// The baseline `coach-failover.test.ts` covers the happy-path cascade.
// This file asserts the *user-facing* error surface when the cascade's
// final failure is a 429: the thrown AppError must use the
// `COACH_RATE_LIMITED` code so `ErrorHandler.mapToUserMessage` renders
// the dedicated rate-limit copy instead of the generic coach-domain
// fallback.

import {
  sendCoachPromptWithFailover,
  type ProviderError,
  type RawProviderResponse,
} from '@/lib/services/coach-failover';
import { mapToUserMessage, type AppError } from '@/lib/services/ErrorHandler';
import { resetCoachTelemetry } from '@/lib/services/coach-telemetry';

beforeEach(() => {
  jest.clearAllMocks();
  resetCoachTelemetry();
});

type InvokeImpl = (
  fn: string,
  body: unknown,
) => Promise<{ data: RawProviderResponse | null; error: ProviderError | null }>;

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('coach-failover — 429 rate-limited mapping', () => {
  it('surfaces COACH_RATE_LIMITED when both primary and secondary 429', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'gemma quota', status: 429 },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'openai quota', status: 429 },
      });

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke }),
    ).rejects.toMatchObject({
      domain: 'coach',
      code: 'COACH_RATE_LIMITED',
    });
  });

  it('maps the thrown error through ErrorHandler.mapToUserMessage to the friendly copy', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'primary 429', status: 429 },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'secondary 429', status: 429 },
      });

    try {
      await sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke });
      throw new Error('expected rejection');
    } catch (err) {
      const copy = mapToUserMessage(err as AppError);
      expect(copy).toMatch(/rate-limited/i);
      expect(copy).not.toMatch(/please try again$/i); // not the generic coach fallback
    }
  });

  it('still falls over on primary 429 when the secondary succeeds (no regression)', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'gemma 429', status: 429 },
      })
      .mockResolvedValueOnce({ data: { message: 'openai saved the day' }, error: null });

    const result = await sendCoachPromptWithFailover(messages, undefined, {
      invokeImpl: invoke,
    });
    expect(result.content).toBe('openai saved the day');
  });

  it('falls through to the generic COACH_FAILOVER_PROVIDER_ERROR when secondary fails with 5xx', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'gemma 429', status: 429 },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'openai 503', status: 503 },
      });

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke }),
    ).rejects.toMatchObject({
      code: 'COACH_FAILOVER_PROVIDER_ERROR',
    });
  });

  it('includes numeric Retry-After hint in the user message when present on the final 429', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'primary 429', status: 429, retryAfter: 45 },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'secondary 429', status: 429, retryAfter: 45 },
      });

    try {
      await sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke });
      throw new Error('expected rejection');
    } catch (err) {
      const appError = err as AppError;
      expect(appError.code).toBe('COACH_RATE_LIMITED');
      expect(appError.message).toMatch(/in 45s/);
      expect((appError.details as { retryAfter: number | string }).retryAfter).toBe(45);
    }
  });

  it('renders Retry-After HTTP-date strings verbatim', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'primary 429', status: 429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'secondary 429', status: 429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT' },
      });

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke }),
    ).rejects.toMatchObject({
      code: 'COACH_RATE_LIMITED',
      message: expect.stringContaining('Wed, 21 Oct 2026'),
    });
  });

  it('converts numeric-string Retry-After (delta-seconds) into minutes over 60s', async () => {
    const invoke: InvokeImpl = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'primary 429', status: 429, retryAfter: '120' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'secondary 429', status: 429, retryAfter: '120' },
      });

    await expect(
      sendCoachPromptWithFailover(messages, undefined, { invokeImpl: invoke }),
    ).rejects.toMatchObject({
      code: 'COACH_RATE_LIMITED',
      message: expect.stringMatching(/in 2 minutes/),
    });
  });
});
