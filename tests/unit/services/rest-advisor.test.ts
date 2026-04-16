import {
  suggestRestSeconds,
  heuristicRestSeconds,
} from '@/lib/services/rest-advisor';
import type { CoachMessage } from '@/lib/services/coach-service';

describe('heuristicRestSeconds', () => {
  it('returns base for low-intensity set with no HR/RPE', () => {
    const advice = heuristicRestSeconds({ lastRepTempoMs: 1200, goalProfile: 'hypertrophy' });
    expect(advice.seconds).toBe(75);
    expect(advice.reasoning).toMatch(/base 75s/);
  });

  it('adds tempo penalty for slow last rep', () => {
    const fast = heuristicRestSeconds({ lastRepTempoMs: 1200, goalProfile: 'hypertrophy' });
    const slow = heuristicRestSeconds({ lastRepTempoMs: 2800, goalProfile: 'hypertrophy' });
    expect(slow.seconds).toBeGreaterThan(fast.seconds);
    expect(slow.reasoning).toMatch(/slow last rep/);
  });

  it('adds HR penalty when HR elevated', () => {
    const low = heuristicRestSeconds({ lastRepTempoMs: 1200, hrBpm: 110, goalProfile: 'hypertrophy' });
    const high = heuristicRestSeconds({ lastRepTempoMs: 1200, hrBpm: 155, goalProfile: 'hypertrophy' });
    expect(high.seconds).toBeGreaterThan(low.seconds);
  });

  it('adds RPE penalty proportionally', () => {
    const rpe6 = heuristicRestSeconds({ lastRepTempoMs: 1200, setRpe: 6, goalProfile: 'hypertrophy' });
    const rpe9 = heuristicRestSeconds({ lastRepTempoMs: 1200, setRpe: 9, goalProfile: 'hypertrophy' });
    expect(rpe9.seconds).toBeGreaterThan(rpe6.seconds);
  });

  it('uses strength base when goal=strength', () => {
    const advice = heuristicRestSeconds({ lastRepTempoMs: 1200, goalProfile: 'strength' });
    expect(advice.seconds).toBe(150);
  });

  it('clamps seconds within [10, 900]', () => {
    const extreme = heuristicRestSeconds({
      lastRepTempoMs: 5000,
      hrBpm: 200,
      setRpe: 10,
      goalProfile: 'strength',
    });
    expect(extreme.seconds).toBeLessThanOrEqual(900);
    expect(extreme.seconds).toBeGreaterThanOrEqual(10);
  });
});

describe('suggestRestSeconds', () => {
  const validResponse = JSON.stringify({ seconds: 120, reasoning: 'Test rationale.' });

  it('returns parsed LLM advice on success (tempo only)', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: validResponse,
    });
    const advice = await suggestRestSeconds(
      { lastRepTempoMs: 1500 },
      { dispatch, timeoutMs: 1000 },
    );
    expect(advice.seconds).toBe(120);
    expect(advice.reasoning).toBe('Test rationale.');
  });

  it('includes tempo + HR in dispatched message', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: validResponse,
    });
    await suggestRestSeconds(
      { lastRepTempoMs: 2000, hrBpm: 140 },
      { dispatch, timeoutMs: 1000 },
    );
    const final = dispatch.mock.calls[0][0].at(-1)!.content;
    expect(final).toMatch(/2000ms/);
    expect(final).toMatch(/140bpm/);
  });

  it('includes tempo + HR + RPE when all present', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockResolvedValue({
      role: 'assistant',
      content: validResponse,
    });
    await suggestRestSeconds(
      { lastRepTempoMs: 2500, hrBpm: 150, setRpe: 8, goalProfile: 'strength' },
      { dispatch, timeoutMs: 1000 },
    );
    const final = dispatch.mock.calls[0][0].at(-1)!.content;
    expect(final).toMatch(/RPE: 8/);
    expect(final).toMatch(/Goal: strength/);
  });

  it('falls back to heuristic on Gemma timeout', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ role: 'assistant', content: validResponse }), 500)),
    );
    const advice = await suggestRestSeconds(
      { lastRepTempoMs: 1200, goalProfile: 'hypertrophy' },
      { dispatch, timeoutMs: 50 },
    );
    expect(advice.reasoning).toMatch(/Heuristic/);
    expect(advice.seconds).toBe(75);
  });

  it('falls back to heuristic on dispatch error', async () => {
    const dispatch = jest.fn<Promise<CoachMessage>, [CoachMessage[]]>().mockRejectedValue(new Error('boom'));
    const advice = await suggestRestSeconds(
      { lastRepTempoMs: 1200, goalProfile: 'endurance' },
      { dispatch, timeoutMs: 500 },
    );
    expect(advice.reasoning).toMatch(/Heuristic/);
    expect(advice.seconds).toBe(45);
  });

  it('falls back to heuristic on malformed JSON (maxRetries=0)', async () => {
    const dispatch = jest
      .fn<Promise<CoachMessage>, [CoachMessage[]]>()
      .mockResolvedValue({ role: 'assistant', content: 'not json' });
    const advice = await suggestRestSeconds(
      { lastRepTempoMs: 1200, goalProfile: 'hypertrophy' },
      { dispatch, timeoutMs: 500, maxRetries: 0 },
    );
    expect(advice.reasoning).toMatch(/Heuristic/);
  });
});
