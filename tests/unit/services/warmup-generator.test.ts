import {
  generateWarmup,
  WARMUP_PLAN_SCHEMA,
  type WarmupPlan,
} from '@/lib/services/warmup-generator';
import {
  buildWarmupGeneratorMessages,
  WARMUP_GENERATOR_SYSTEM_PROMPT,
} from '@/lib/services/warmup-generator-prompt';
import type { CoachMessage } from '@/lib/services/coach-service';

const VALID_PLAN: WarmupPlan = {
  name: 'Test Warmup',
  duration_min: 6,
  movements: [
    { name: 'Cat-cow', duration_seconds: 60, focus: 'mobility', intensity: 'low' },
    { name: 'Bodyweight squat', reps: 10, focus: 'activation', intensity: 'low' },
  ],
};

describe('warmup-generator-prompt', () => {
  it('builds messages with system prompt and user instruction', () => {
    const messages = buildWarmupGeneratorMessages({
      exerciseSlugs: ['squat', 'deadlift'],
      durationMin: 8,
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(WARMUP_GENERATOR_SYSTEM_PROMPT);
    expect(messages.at(-1)?.content).toMatch(/squat, deadlift/);
    expect(messages.at(-1)?.content).toMatch(/8 min/);
  });

  it('includes user context when provided', () => {
    const messages = buildWarmupGeneratorMessages({
      exerciseSlugs: ['bench'],
      userContext: 'Tight shoulders',
    });
    expect(messages.at(-1)?.content).toMatch(/Tight shoulders/);
  });
});

describe('WARMUP_PLAN_SCHEMA', () => {
  it('accepts a valid plan', () => {
    expect(WARMUP_PLAN_SCHEMA.validate(VALID_PLAN).ok).toBe(true);
  });

  it('rejects empty movements array', () => {
    const result = WARMUP_PLAN_SCHEMA.validate({ ...VALID_PLAN, movements: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects bad focus enum', () => {
    const result = WARMUP_PLAN_SCHEMA.validate({
      ...VALID_PLAN,
      movements: [{ name: 'x', reps: 1, focus: 'bogus', intensity: 'low' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('generateWarmup', () => {
  it('dispatches, parses, and returns plan', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify(VALID_PLAN),
    });
    const plan = await generateWarmup(
      { exerciseSlugs: ['squat'], durationMin: 6 },
      { dispatch },
    );
    expect(plan.name).toBe('Test Warmup');
    expect(plan.movements.length).toBe(2);
  });

  it('retries on bad JSON and succeeds', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockResolvedValueOnce({ role: 'assistant', content: 'nope' })
      .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify(VALID_PLAN) });
    const plan = await generateWarmup(
      { exerciseSlugs: ['x'] },
      { dispatch, maxRetries: 1 },
    );
    expect(plan.name).toBe('Test Warmup');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('throws when retries exhausted', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockResolvedValue({ role: 'assistant', content: 'still bad' });
    await expect(
      generateWarmup({ exerciseSlugs: ['x'] }, { dispatch, maxRetries: 1 }),
    ).rejects.toMatchObject({ code: 'GEMMA_JSON_RETRY_EXHAUSTED' });
  });

  describe('EXPO_PUBLIC_GEMMA_SESSION_GEN gate', () => {
    const ENV_VAR = 'EXPO_PUBLIC_GEMMA_SESSION_GEN';
    const originalValue = process.env[ENV_VAR];

    afterEach(() => {
      if (originalValue === undefined) {
        delete process.env[ENV_VAR];
      } else {
        process.env[ENV_VAR] = originalValue;
      }
    });

    it('rejects with GEMMA_SESSION_GEN_DISABLED when flag off and no dispatch override', async () => {
      delete process.env[ENV_VAR];
      await expect(
        generateWarmup({ exerciseSlugs: ['squat'] }),
      ).rejects.toMatchObject({ code: 'GEMMA_SESSION_GEN_DISABLED' });
    });

    it('runs normally when flag off but dispatch override is supplied', async () => {
      delete process.env[ENV_VAR];
      const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
        role: 'assistant',
        content: JSON.stringify(VALID_PLAN),
      });
      const plan = await generateWarmup({ exerciseSlugs: ['squat'] }, { dispatch });
      expect(plan.name).toBe('Test Warmup');
    });
  });
});
