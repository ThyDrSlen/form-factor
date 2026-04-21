/**
 * Tests the pipeline-v2 model-dispatch wiring in coach-service. Verifies
 * `decideCoachModel` is consulted when both master + dispatch flags are on
 * and the caller provides a task kind.
 */

const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ insert: mockInsert }));
const mockGemmaSend = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

jest.mock('@/lib/services/coach-gemma-service', () => ({
  sendCoachGemmaPrompt: (...args: unknown[]) => mockGemmaSend(...args),
}));

const FLAG = 'EXPO_PUBLIC_COACH_PIPELINE_V2';
const DISPATCH = 'EXPO_PUBLIC_COACH_DISPATCH';

describe('coach-service task-kind model dispatch (pipeline-v2)', () => {
  let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];
  const originalFlag = process.env[FLAG];
  const originalDispatch = process.env[DISPATCH];
  const baseMessages = [{ role: 'user' as const, content: 'help' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { message: 'gpt reply' }, error: null });
    mockGemmaSend.mockResolvedValue({ role: 'assistant', content: 'gemma reply' });
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [k, v] of [
      [FLAG, originalFlag],
      [DISPATCH, originalDispatch],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('tactical task (rest_calc) routes to Gemma when pipeline + dispatch flags are on', async () => {
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';

    const result = await sendCoachPrompt(baseMessages, undefined, {
      taskKind: 'rest_calc',
      userTier: 'pro',
    });

    expect(result.content).toBe('gemma reply');
    expect(mockGemmaSend).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('complex task (multi_turn_debrief) routes to GPT via the cloud edge function', async () => {
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';

    const result = await sendCoachPrompt(baseMessages, undefined, {
      taskKind: 'multi_turn_debrief',
      userTier: 'free',
    });

    expect(result.content).toBe('gpt reply');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockGemmaSend).not.toHaveBeenCalled();
  });

  it('pipeline flag off: task kind is ignored (preserves default behavior)', async () => {
    delete process.env[FLAG];
    process.env[DISPATCH] = 'on';

    const result = await sendCoachPrompt(baseMessages, undefined, {
      taskKind: 'rest_calc',
      userTier: 'pro',
    });

    // Default provider is openai → cloud edge function, not Gemma.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockGemmaSend).not.toHaveBeenCalled();
    expect(result.content).toBe('gpt reply');
  });

  it('explicit provider hint takes precedence over dispatcher decision', async () => {
    process.env[FLAG] = 'on';
    process.env[DISPATCH] = 'on';

    await sendCoachPrompt(baseMessages, undefined, {
      taskKind: 'rest_calc', // tactical → Gemma by dispatcher
      userTier: 'pro',
      provider: 'openai', // but caller pins openai
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockGemmaSend).not.toHaveBeenCalled();
  });
});
