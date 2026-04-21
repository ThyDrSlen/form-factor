/**
 * Tests the pipeline-v2 shape wiring in coach-service. Verifies
 * shapeFinalResponse is called when EXPO_PUBLIC_COACH_PIPELINE_V2=on and
 * is a no-op when the flag is off.
 */

const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({
  insert: mockInsert,
}));
const mockShape = jest.fn((text: string) => `[SHAPED] ${text.trim()}`);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

jest.mock('@/lib/services/coach-output-shaper', () => ({
  shapeFinalResponse: (text: string) => mockShape(text),
}));

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_PIPELINE_V2';

describe('coach-service shape wiring (pipeline-v2 flag)', () => {
  let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];
  const originalFlag = process.env[FLAG_ENV_VAR];
  const baseMessages = [{ role: 'user' as const, content: 'Hi coach.' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { message: 'Raw reply.' }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFlag === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalFlag;
    }
  });

  it('applies shapeFinalResponse when the pipeline-v2 flag is on', async () => {
    process.env[FLAG_ENV_VAR] = 'on';

    const result = await sendCoachPrompt(baseMessages);

    expect(mockShape).toHaveBeenCalledWith('Raw reply.');
    expect(result.content).toBe('[SHAPED] Raw reply.');
  });

  it('skips shapeFinalResponse when the pipeline-v2 flag is off', async () => {
    delete process.env[FLAG_ENV_VAR];

    const result = await sendCoachPrompt(baseMessages);

    expect(mockShape).not.toHaveBeenCalled();
    expect(result.content).toBe('Raw reply.');
  });

  it('skips shaping when the flag is any value other than "on"', async () => {
    process.env[FLAG_ENV_VAR] = 'true';

    const result = await sendCoachPrompt(baseMessages);

    expect(mockShape).not.toHaveBeenCalled();
    expect(result.content).toBe('Raw reply.');
  });
});
