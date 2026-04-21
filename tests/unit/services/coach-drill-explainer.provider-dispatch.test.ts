/**
 * Pipeline-v2 provider dispatch tests for coach-drill-explainer.
 * Verifies EXPO_PUBLIC_COACH_CLOUD_PROVIDER is honoured when the master
 * flag is on; legacy behavior (hardcoded 'cloud') when the flag is off.
 */

const mockSendCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: mockSendCoachPrompt,
}));

import type { ExplainDrillInput } from '@/lib/services/coach-drill-explainer';

let explainDrill: typeof import('@/lib/services/coach-drill-explainer')['explainDrill'];

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const PROVIDER = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
const originalFlag = process.env[FLAG];
const originalProvider = process.env[PROVIDER];

const baseInput: ExplainDrillInput = {
  drillTitle: 'Tempo squat',
  drillCategory: 'technique',
  drillWhy: 'why',
  exerciseId: 'squat',
  faults: [{ code: 'shallow_depth', count: 2, severity: 2 }],
};

describe('coach-drill-explainer provider dispatch (pipeline-v2)', () => {
  beforeAll(() => {
    ({ explainDrill } = require('@/lib/services/coach-drill-explainer'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'ok' });
  });

  afterEach(() => {
    for (const [k, v] of [
      [FLAG, originalFlag],
      [PROVIDER, originalProvider],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('passes provider=gemma through sendCoachPrompt when flag is on and env=gemma', async () => {
    process.env[FLAG] = 'on';
    process.env[PROVIDER] = 'gemma';
    const result = await explainDrill(baseInput);

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'gemma' });
    expect(result.provider).toBe('gemma');
  });

  it('passes provider=openai through sendCoachPrompt when flag is on and env=openai', async () => {
    process.env[FLAG] = 'on';
    process.env[PROVIDER] = 'openai';
    const result = await explainDrill(baseInput);

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'openai' });
    expect(result.provider).toBe('openai');
  });

  it('preserves legacy cloud behavior when flag is off', async () => {
    delete process.env[FLAG];
    process.env[PROVIDER] = 'gemma';
    const result = await explainDrill(baseInput);

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(result.provider).toBe('cloud');
  });
});
