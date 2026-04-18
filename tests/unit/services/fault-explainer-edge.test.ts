jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  infoWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

import { createEdgeFaultExplainer } from '@/lib/services/fault-explainer-edge';
import type { FaultSynthesisInput } from '@/lib/services/fault-explainer';
import { supabase } from '@/lib/supabase';

const mockInvoke = supabase.functions.invoke as jest.Mock;

const sampleInput: FaultSynthesisInput = {
  exerciseId: 'squat',
  faultIds: ['shallow_depth', 'forward_lean', 'hip_shift'],
};

describe('createEdgeFaultExplainer', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('maps a valid Edge Function response to FaultSynthesisOutput', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        synthesizedExplanation: '  Three faults trace back to ankle mobility.  ',
        primaryFaultId: 'shallow_depth',
        rootCauseHypothesis: 'ankle mobility',
        confidence: 0.82,
      },
      error: null,
    });

    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);

    expect(out.source).toBe('edge-function');
    expect(out.synthesizedExplanation).toBe('Three faults trace back to ankle mobility.');
    expect(out.primaryFaultId).toBe('shallow_depth');
    expect(out.rootCauseHypothesis).toBe('ankle mobility');
    expect(out.confidence).toBeCloseTo(0.82);
  });

  it('clamps confidence into [0,1]', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        synthesizedExplanation: 'ok',
        primaryFaultId: null,
        rootCauseHypothesis: null,
        confidence: 1.8,
      },
      error: null,
    });
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);
    expect(out.confidence).toBe(1);
  });

  it('falls back to static when the invoke returns an error', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { message: '502 bad gateway' },
    });
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);
    expect(out.source).toBe('static-fallback');
    expect(out.synthesizedExplanation.length).toBeGreaterThan(0);
  });

  it('falls back to static when the response shape is invalid', async () => {
    mockInvoke.mockResolvedValue({
      data: { synthesizedExplanation: '', confidence: 0.5 },
      error: null,
    });
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);
    expect(out.source).toBe('static-fallback');
  });

  it('falls back to static when the response has an error field', async () => {
    mockInvoke.mockResolvedValue({
      data: { error: 'quota exceeded' },
      error: null,
    });
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);
    expect(out.source).toBe('static-fallback');
  });

  it('falls back to static when the invoke throws', async () => {
    mockInvoke.mockRejectedValue(new Error('network down'));
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize(sampleInput);
    expect(out.source).toBe('static-fallback');
  });

  it('falls back to static when the call times out', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const runner = createEdgeFaultExplainer({ timeoutMs: 20 });
    const out = await runner.synthesize(sampleInput);
    expect(out.source).toBe('static-fallback');
  });

  it('short-circuits to static for empty fault input without calling the Edge Function', async () => {
    const runner = createEdgeFaultExplainer();
    const out = await runner.synthesize({ exerciseId: 'squat', faultIds: [] });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(out.source).toBe('static-fallback');
  });

  it('enriches the request body with glossary snippets for the faults', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        synthesizedExplanation: 'ok',
        primaryFaultId: null,
        rootCauseHypothesis: null,
        confidence: 0.5,
      },
      error: null,
    });
    const runner = createEdgeFaultExplainer();
    await runner.synthesize(sampleInput);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, invokeOptions] = mockInvoke.mock.calls[0];
    const body = invokeOptions.body as {
      exerciseId: string;
      faultIds: string[];
      glossaryEntries: Array<{ faultId: string; displayName: string; fixTips: string[] }>;
    };
    expect(body.exerciseId).toBe('squat');
    expect(body.faultIds).toEqual(sampleInput.faultIds);
    expect(body.glossaryEntries.length).toBe(3);
    const snippetFaultIds = body.glossaryEntries.map((s) => s.faultId);
    expect(snippetFaultIds).toEqual(expect.arrayContaining(sampleInput.faultIds));
    for (const snippet of body.glossaryEntries) {
      expect(snippet.displayName).toBeTruthy();
      expect(snippet.fixTips.length).toBeGreaterThan(0);
    }
  });

  it('honors a custom function name', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        synthesizedExplanation: 'ok',
        primaryFaultId: null,
        rootCauseHypothesis: null,
        confidence: 0.5,
      },
      error: null,
    });
    const runner = createEdgeFaultExplainer({ functionName: 'custom-fn' });
    await runner.synthesize(sampleInput);
    expect(mockInvoke).toHaveBeenCalledWith('custom-fn', expect.anything());
  });
});
