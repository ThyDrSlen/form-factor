/**
 * Pipeline-v2 provider dispatch tests for coach-drill-explainer.
 * Verifies EXPO_PUBLIC_COACH_CLOUD_PROVIDER is honoured when the master
 * flag is on; legacy behavior (hardcoded 'cloud') when the flag is off.
 *
 * Provider label semantics (#539): the returned `provider` field reflects
 * which path *actually* authored the reply, not just which one we hinted
 * at. With dispatch flag OFF the Gemma-first attempt is skipped and the
 * fallback path runs; since the fallback always lands on the OpenAI edge
 * function, the label is 'openai' even when env=gemma.
 */

const mockSendCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: mockSendCoachPrompt,
}));

import type { ExplainDrillInput } from '@/lib/services/coach-drill-explainer';

let explainDrill: typeof import('@/lib/services/coach-drill-explainer')['explainDrill'];

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const PROVIDER = 'EXPO_PUBLIC_COACH_CLOUD_PROVIDER';
const DISPATCH = 'EXPO_PUBLIC_COACH_DISPATCH';
const originalFlag = process.env[FLAG];
const originalProvider = process.env[PROVIDER];
const originalDispatch = process.env[DISPATCH];

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
      [DISPATCH, originalDispatch],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('passes provider=gemma through sendCoachPrompt and labels reply gemma when both flags on (#539)', async () => {
    // Both flags on → gemma-first path. Gemma replies → label 'gemma'.
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';
    process.env[PROVIDER] = 'gemma';
    const result = await explainDrill(baseInput);

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'gemma' });
    expect(result.provider).toBe('gemma');
  });

  it('passes provider=openai through sendCoachPrompt when flag is on and env=openai', async () => {
    // Pipeline-v2 on, dispatch off → no gemma-first attempt. Env points
    // at openai → hint it through, reply authored by openai, label 'openai'.
    process.env[FLAG] = 'on';
    process.env[PROVIDER] = 'openai';
    const result = await explainDrill(baseInput);

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toEqual({ provider: 'openai' });
    expect(result.provider).toBe('openai');
  });

  it('labels reply openai when env=gemma but dispatch flag is off (#539 — actual path wins)', async () => {
    // Pipeline-v2 on, dispatch OFF → gemma-first is skipped. We still
    // forward the provider hint from the env resolver, but since the
    // dispatch flag is off inside sendCoachPrompt, Gemma is not actually
    // called — OpenAI owns the turn. Label reflects the authoring path.
    process.env[FLAG] = 'on';
    delete process.env[DISPATCH];
    process.env[PROVIDER] = 'gemma';
    const result = await explainDrill(baseInput);

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openai');
  });

  it('labels reply openai when Gemma-first fails and falls back (#539)', async () => {
    // Gemma-first path errors → fallback to OpenAI. Label reflects the
    // path that actually produced the text, not the preferred one.
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';
    process.env[PROVIDER] = 'gemma';
    mockSendCoachPrompt
      .mockRejectedValueOnce(new Error('gemma unavailable'))
      .mockResolvedValueOnce({ role: 'assistant', content: 'openai fallback reply' });

    const result = await explainDrill(baseInput);

    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(2);
    expect(result.explanation).toBe('openai fallback reply');
    expect(result.provider).toBe('openai');
  });

  it('labels reply openai when Gemma-first returns empty and falls back (#539)', async () => {
    // Empty Gemma reply is indistinguishable from a real failure from the
    // user's perspective — fall through to OpenAI and label accordingly.
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';
    process.env[PROVIDER] = 'gemma';
    mockSendCoachPrompt
      .mockResolvedValueOnce({ role: 'assistant', content: '   ' })
      .mockResolvedValueOnce({ role: 'assistant', content: 'openai fallback' });

    const result = await explainDrill(baseInput);
    expect(result.explanation).toBe('openai fallback');
    expect(result.provider).toBe('openai');
  });

  it('preserves legacy cloud behavior when pipeline-v2 flag is off', async () => {
    // Pipeline-v2 off → no provider resolution, legacy 'cloud' label.
    delete process.env[FLAG];
    process.env[PROVIDER] = 'gemma';
    const result = await explainDrill(baseInput);

    const [, , opts] = mockSendCoachPrompt.mock.calls[0];
    expect(opts).toBeUndefined();
    expect(result.provider).toBe('cloud');
  });
});
