import {
  generateCooldown,
  COOLDOWN_PLAN_SCHEMA,
  type CooldownPlan,
} from '@/lib/services/cooldown-generator';
import {
  buildCooldownGeneratorMessages,
  COOLDOWN_GENERATOR_SYSTEM_PROMPT,
} from '@/lib/services/cooldown-generator-prompt';
import type { CoachMessage } from '@/lib/services/coach-service';

const VALID_PLAN: CooldownPlan = {
  name: 'Test Cooldown',
  duration_min: 7,
  movements: [
    { name: 'Child pose', duration_seconds: 60, focus: 'stretch', intensity: 'low' },
    { name: 'Box breathing', duration_seconds: 60, focus: 'breathing', intensity: 'low' },
  ],
  reflection_prompt: 'Session RPE?',
};

describe('cooldown-generator-prompt', () => {
  it('builds messages with system prompt and user instruction', () => {
    const messages = buildCooldownGeneratorMessages({
      completedExerciseSlugs: ['squat'],
      sessionRpe: 8,
      durationMin: 7,
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(COOLDOWN_GENERATOR_SYSTEM_PROMPT);
    expect(messages.at(-1)?.content).toMatch(/squat/);
    expect(messages.at(-1)?.content).toMatch(/Session RPE: 8/);
    expect(messages.at(-1)?.content).toMatch(/7 min/);
  });
});

describe('COOLDOWN_PLAN_SCHEMA', () => {
  it('accepts valid plan', () => {
    expect(COOLDOWN_PLAN_SCHEMA.validate(VALID_PLAN).ok).toBe(true);
  });

  it('accepts plan without reflection_prompt', () => {
    const { reflection_prompt: _r, ...rest } = VALID_PLAN;
    void _r;
    expect(COOLDOWN_PLAN_SCHEMA.validate(rest).ok).toBe(true);
  });

  it('rejects empty movements', () => {
    expect(COOLDOWN_PLAN_SCHEMA.validate({ ...VALID_PLAN, movements: [] }).ok).toBe(false);
  });

  it('rejects bad focus enum', () => {
    const result = COOLDOWN_PLAN_SCHEMA.validate({
      ...VALID_PLAN,
      movements: [{ name: 'x', duration_seconds: 10, focus: 'nope', intensity: 'low' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('generateCooldown', () => {
  it('dispatches, parses, and returns plan', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify(VALID_PLAN),
    });
    const plan = await generateCooldown(
      { completedExerciseSlugs: ['squat'], sessionRpe: 8, durationMin: 7 },
      { dispatch },
    );
    expect(plan.name).toBe('Test Cooldown');
    expect(plan.reflection_prompt).toBe('Session RPE?');
  });

  it('retries on bad JSON', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockResolvedValueOnce({ role: 'assistant', content: 'bad' })
      .mockResolvedValueOnce({ role: 'assistant', content: JSON.stringify(VALID_PLAN) });
    const plan = await generateCooldown(
      { completedExerciseSlugs: ['x'] },
      { dispatch, maxRetries: 1 },
    );
    expect(plan.name).toBe('Test Cooldown');
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('throws on retry exhaustion', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockResolvedValue({ role: 'assistant', content: 'still bad' });
    await expect(
      generateCooldown({ completedExerciseSlugs: ['x'] }, { dispatch, maxRetries: 1 }),
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
        generateCooldown({ completedExerciseSlugs: ['squat'] }),
      ).rejects.toMatchObject({ code: 'GEMMA_SESSION_GEN_DISABLED' });
    });

    it('runs normally when flag off but dispatch override is supplied', async () => {
      delete process.env[ENV_VAR];
      const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
        role: 'assistant',
        content: JSON.stringify(VALID_PLAN),
      });
      const plan = await generateCooldown(
        { completedExerciseSlugs: ['squat'] },
        { dispatch },
      );
      expect(plan.name).toBe('Test Cooldown');
    });
  });
});
