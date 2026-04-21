/**
 * Tests the pipeline-v2 safety wiring in coach-service non-stream path.
 * Verifies `evaluateSafety` is applied to cloud responses when the master
 * flag is on and that a violation throws `COACH_CLOUD_UNSAFE`.
 */

const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ insert: mockInsert }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_PIPELINE_V2';

describe('coach-service cloud safety wiring (pipeline-v2 flag)', () => {
  let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];
  const originalFlag = process.env[FLAG_ENV_VAR];
  const baseMessages = [{ role: 'user' as const, content: 'Hi coach.' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFlag === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalFlag;
    }
  });

  it('rejects a cloud response with a safety violation when flag is on', async () => {
    process.env[FLAG_ENV_VAR] = 'on';
    // Payload trips Safety/NoInjuryPushThrough.
    mockInvoke.mockResolvedValue({
      data: { message: 'Push through the pain and keep lifting.' },
      error: null,
    });

    await expect(sendCoachPrompt(baseMessages)).rejects.toMatchObject({
      code: 'COACH_CLOUD_UNSAFE',
    });
  });

  it('allows the same unsafe response through when flag is off', async () => {
    delete process.env[FLAG_ENV_VAR];
    mockInvoke.mockResolvedValue({
      data: { message: 'Push through the pain and keep lifting.' },
      error: null,
    });

    const result = await sendCoachPrompt(baseMessages);
    expect(result.content).toContain('Push through the pain');
  });

  it('passes safe responses through when flag is on', async () => {
    process.env[FLAG_ENV_VAR] = 'on';
    mockInvoke.mockResolvedValue({
      data: { message: 'Keep your chest up and drive through the heels.' },
      error: null,
    });

    const result = await sendCoachPrompt(baseMessages);
    expect(result.content).toContain('Keep your chest up');
  });
});
