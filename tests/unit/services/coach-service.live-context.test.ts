const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn(() => ({ insert: mockInsert }));
const mockCreateError = jest.fn(
  (
    domain: string,
    code: string,
    message: string,
    opts?: { details?: unknown; retryable?: boolean; severity?: string },
  ) => ({
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
    severity: opts?.severity ?? 'error',
    details: opts?.details,
  }),
);

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
}));

jest.mock('../../../lib/services/ErrorHandler', () => ({
  createError: mockCreateError,
  logError: jest.fn(),
}));

import { buildLiveSessionSnapshot } from '@/lib/services/coach-live-snapshot';

let sendCoachPrompt: typeof import('@/lib/services/coach-service')['sendCoachPrompt'];

describe('coach-service livesession threading', () => {
  const baseMessages = [{ role: 'user' as const, content: 'Should I deepen my squat?' }];

  beforeAll(() => {
    ({ sendCoachPrompt } = require('@/lib/services/coach-service'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ data: { message: 'Go a touch deeper.' }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes liveSession in the invoke payload when provided', async () => {
    const liveSession = buildLiveSessionSnapshot({
      exerciseId: 'squat',
      exerciseName: 'Back Squat',
      currentFQI: { rom: 0.9, symmetry: 0.8 },
      recentFaults: [{ id: 'knee_valgus', count: 3 }],
    });
    expect(liveSession).not.toBeNull();

    await sendCoachPrompt(baseMessages, { focus: 'squat', liveSession: liveSession! });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, callOpts] = mockInvoke.mock.calls[0]!;
    expect(callOpts.body.context.liveSession).toEqual(liveSession);
    expect(callOpts.body.context.focus).toBe('squat');
  });

  it('omits liveSession from payload when context is undefined', async () => {
    await sendCoachPrompt(baseMessages);

    const [, callOpts] = mockInvoke.mock.calls[0]!;
    expect(callOpts.body.context).toBeUndefined();
  });

  it('omits liveSession from payload when caller does not set it', async () => {
    await sendCoachPrompt(baseMessages, { focus: 'mobility' });

    const [, callOpts] = mockInvoke.mock.calls[0]!;
    expect(callOpts.body.context.liveSession).toBeUndefined();
    expect(callOpts.body.context.focus).toBe('mobility');
  });

  it('forwards raw liveSession object when caller bypasses builder', async () => {
    const rawSnap = {
      exerciseId: 'dl',
      exerciseName: 'Deadlift',
      recentFaults: [{ id: 'back_round', count: 2, lastRepNumber: 5 }],
    };
    await sendCoachPrompt(baseMessages, { liveSession: rawSnap });

    const [, callOpts] = mockInvoke.mock.calls[0]!;
    expect(callOpts.body.context.liveSession).toEqual(rawSnap);
  });
});
