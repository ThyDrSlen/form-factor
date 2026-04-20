import {
  buildMesocycleAnalystPrompt,
  MESOCYCLE_ANALYST_FOCUS,
  requestMesocycleAnalysis,
} from '@/lib/services/coach-mesocycle-analyst';
import type { MesocycleInsights } from '@/lib/services/form-mesocycle-aggregator';

function fullInsights(overrides: Partial<MesocycleInsights> = {}): MesocycleInsights {
  return {
    referenceIso: '2026-04-17T00:00:00.000Z',
    weeks: [
      { weekStartIso: '2026-03-23', weekIndex: 0, avgFqi: 70, sessionsCount: 1, repsCount: 10, setsCount: 2 },
      { weekStartIso: '2026-03-30', weekIndex: 1, avgFqi: 75, sessionsCount: 2, repsCount: 20, setsCount: 4 },
      { weekStartIso: '2026-04-06', weekIndex: 2, avgFqi: 80, sessionsCount: 2, repsCount: 22, setsCount: 5 },
      { weekStartIso: '2026-04-13', weekIndex: 3, avgFqi: 82, sessionsCount: 3, repsCount: 28, setsCount: 6 },
    ],
    topFaults: [
      { fault: 'valgus', count: 9, share: 0.1 },
      { fault: 'hips_rise', count: 4, share: 0.05 },
    ],
    deload: { severity: 'watch', fqiDelta: -6, faultDelta: 0.1, reason: 'Form quality is trending down this week — keep an eye on load progression.' },
    isEmpty: false,
    ...overrides,
  };
}

describe('buildMesocycleAnalystPrompt', () => {
  it('returns an onboarding prompt when the window is empty', () => {
    const insights = fullInsights({
      weeks: [
        { weekStartIso: '2026-03-23', weekIndex: 0, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-03-30', weekIndex: 1, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-04-06', weekIndex: 2, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
        { weekStartIso: '2026-04-13', weekIndex: 3, avgFqi: null, sessionsCount: 0, repsCount: 0, setsCount: 0 },
      ],
      topFaults: [],
      isEmpty: true,
      deload: { severity: 'none', fqiDelta: null, faultDelta: null, reason: null },
    });
    const prompt = buildMesocycleAnalystPrompt(insights);
    expect(prompt).toMatch(/no data yet/);
    expect(prompt).toMatch(/4 weeks of form tracking/);
  });

  it('folds each weekly bucket into the prompt', () => {
    const prompt = buildMesocycleAnalystPrompt(fullInsights());
    expect(prompt).toMatch(/W1 \(2026-03-23\): FQI 70/);
    expect(prompt).toMatch(/W4 \(2026-04-13\): FQI 82/);
  });

  it('lists recurring faults with counts', () => {
    const prompt = buildMesocycleAnalystPrompt(fullInsights());
    expect(prompt).toMatch(/valgus ×9/);
    expect(prompt).toMatch(/hips_rise ×4/);
  });

  it('reports "no recurring faults" when the histogram is empty', () => {
    const prompt = buildMesocycleAnalystPrompt(fullInsights({ topFaults: [] }));
    expect(prompt).toMatch(/no recurring faults/);
  });

  it('reports deload severity and reason when present', () => {
    const prompt = buildMesocycleAnalystPrompt(fullInsights());
    expect(prompt).toMatch(/deload signal watch/);
    expect(prompt).toMatch(/load progression/);
  });

  it('reports a clear deload signal when severity is none', () => {
    const prompt = buildMesocycleAnalystPrompt(
      fullInsights({
        deload: { severity: 'none', fqiDelta: 1, faultDelta: 0, reason: null },
      }),
    );
    expect(prompt).toMatch(/deload signal clear/);
  });

  it('constrains the response length via an explicit instruction', () => {
    const prompt = buildMesocycleAnalystPrompt(fullInsights());
    expect(prompt).toMatch(/150 words/);
    expect(prompt).toMatch(/one concrete next step/);
  });
});

describe('requestMesocycleAnalysis', () => {
  it('routes the prompt through sendCoachPrompt with the mesocycle-analyst focus', async () => {
    const send = jest.fn().mockResolvedValue({
      message: { role: 'assistant', content: 'Cut volume 10% and add one glute-bridge warmup.' },
    });
    const result = await requestMesocycleAnalysis(fullInsights(), send);

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.context).toEqual({ focus: MESOCYCLE_ANALYST_FOCUS });
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[0].content).toMatch(/4 weeks of form tracking/);

    expect(result).toEqual({
      text: 'Cut volume 10% and add one glute-bridge warmup.',
      provider: 'cloud',
    });
  });

  it('returns null when the coach response is empty', async () => {
    const send = jest.fn().mockResolvedValue({ message: { role: 'assistant', content: '' } });
    const result = await requestMesocycleAnalysis(fullInsights(), send);
    expect(result).toBeNull();
  });

  it('returns null when sendCoachPrompt returns null', async () => {
    const send = jest.fn().mockResolvedValue(null);
    const result = await requestMesocycleAnalysis(fullInsights(), send);
    expect(result).toBeNull();
  });

  it('trims whitespace from the coach response', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ message: { role: 'assistant', content: '  next: deload 10%.  ' } });
    const result = await requestMesocycleAnalysis(fullInsights(), send);
    expect(result?.text).toBe('next: deload 10%.');
  });
});
