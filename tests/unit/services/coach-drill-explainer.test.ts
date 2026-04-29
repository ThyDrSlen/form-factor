const mockSendCoachPrompt = jest.fn();

jest.mock('@/lib/services/coach-service', () => ({
  sendCoachPrompt: mockSendCoachPrompt,
}));

import type { ExplainDrillInput } from '@/lib/services/coach-drill-explainer';

let buildDrillExplainerMessages: typeof import('@/lib/services/coach-drill-explainer')['buildDrillExplainerMessages'];
let DRILL_EXPLAINER_SYSTEM_PROMPT: typeof import('@/lib/services/coach-drill-explainer')['DRILL_EXPLAINER_SYSTEM_PROMPT'];
let explainDrill: typeof import('@/lib/services/coach-drill-explainer')['explainDrill'];

const baseInput: ExplainDrillInput = {
  drillTitle: 'Tempo squat — 3s down, 2s pause, 0 up',
  drillCategory: 'technique',
  drillWhy: 'Slower descent trains depth awareness.',
  exerciseId: 'squat',
  faults: [
    { code: 'shallow_depth', displayName: 'Shallow Depth', count: 3, severity: 2 },
    { code: 'forward_lean', displayName: 'Excessive Forward Lean', count: 1, severity: 3 },
  ],
};

describe('coach-drill-explainer', () => {
  beforeAll(() => {
    ({
      buildDrillExplainerMessages,
      DRILL_EXPLAINER_SYSTEM_PROMPT,
      explainDrill,
    } = require('@/lib/services/coach-drill-explainer'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a two-message payload with SYSTEM prompt', () => {
    const msgs = buildDrillExplainerMessages(baseInput);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(DRILL_EXPLAINER_SYSTEM_PROMPT);
    expect(msgs[1].role).toBe('user');
  });

  it('includes drill title, category, exerciseId, and fault summary in user message', () => {
    const msgs = buildDrillExplainerMessages(baseInput);
    const userText = msgs[1].content;
    expect(userText).toContain(baseInput.drillTitle);
    expect(userText).toContain(baseInput.drillCategory);
    expect(userText).toContain('squat');
    expect(userText).toContain('Shallow Depth');
    expect(userText).toContain('Excessive Forward Lean');
    expect(userText).toMatch(/3×|3x/i);
    expect(userText).toMatch(/major/);
    expect(userText).toMatch(/moderate/);
  });

  it('falls back to fault code when displayName is missing', () => {
    const msgs = buildDrillExplainerMessages({
      ...baseInput,
      faults: [{ code: 'knee_valgus', count: 2, severity: 3 }],
    });
    expect(msgs[1].content).toContain('knee valgus');
  });

  it('reports "no specific faults" when faults is empty', () => {
    const msgs = buildDrillExplainerMessages({ ...baseInput, faults: [] });
    expect(msgs[1].content).toMatch(/no specific faults/i);
  });

  it('includes lifter name when provided', () => {
    const msgs = buildDrillExplainerMessages({ ...baseInput, userName: 'Alex' });
    expect(msgs[1].content).toContain('Alex');
  });

  it('omits lifter name when not provided', () => {
    const msgs = buildDrillExplainerMessages(baseInput);
    expect(msgs[1].content).not.toMatch(/Lifter name/);
  });

  it('routes to sendCoachPrompt with focus="drill-explainer"', async () => {
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: 'Tempo work fixes depth.' });
    const result = await explainDrill(baseInput);
    expect(mockSendCoachPrompt).toHaveBeenCalledTimes(1);
    const [, context] = mockSendCoachPrompt.mock.calls[0];
    expect(context.focus).toBe('drill-explainer');
    expect(result.explanation).toBe('Tempo work fixes depth.');
    expect(result.provider).toBe('cloud');
    expect(result.error).toBeUndefined();
  });

  it('trims whitespace from coach response', async () => {
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: '   Fix depth.\n\n' });
    const result = await explainDrill(baseInput);
    expect(result.explanation).toBe('Fix depth.');
  });

  it('reports empty-response error when coach returns blank content', async () => {
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant', content: '   ' });
    const result = await explainDrill(baseInput);
    expect(result.explanation).toBe('');
    expect(result.error).toMatch(/empty response/i);
  });

  it('reports the underlying error message when coach throws', async () => {
    mockSendCoachPrompt.mockRejectedValue(new Error('Coach down'));
    const result = await explainDrill(baseInput);
    expect(result.explanation).toBe('');
    expect(result.error).toBe('Coach down');
    // Pipeline-v2 flag is OFF in this test (not set in env), so legacy
    // 'cloud' label applies.
    expect(result.provider).toBe('cloud');
  });

  it('handles non-Error throw values gracefully', async () => {
    mockSendCoachPrompt.mockRejectedValue('plain string');
    const result = await explainDrill(baseInput);
    expect(result.error).toMatch(/unknown coach error/i);
  });

  it('treats missing content field as empty response', async () => {
    mockSendCoachPrompt.mockResolvedValue({ role: 'assistant' });
    const result = await explainDrill(baseInput);
    expect(result.error).toMatch(/empty response/i);
  });
});
