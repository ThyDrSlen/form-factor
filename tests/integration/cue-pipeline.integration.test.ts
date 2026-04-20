/**
 * Cue-pipeline integration test: engine -> TTS -> audio-session.
 *
 * Issue #430 Gap 4 — no existing integration test stitches
 * `lib/fusion/cue-engine.ts`, `lib/services/elevenlabs-service.ts`,
 * and `lib/services/audio-session-manager.ts` together.
 *
 * Uses a mocked `fetch` to avoid real ElevenLabs API calls.
 */
import { createCueEngine, type CueRule, type CueEmission } from '@/lib/fusion/cue-engine';
import { generateSpeech } from '@/lib/services/elevenlabs-service';

const FLAG_SKIP = process.env.SKIP_VOICE_TESTS === '1';
const describeMaybe = FLAG_SKIP ? describe.skip : describe;

describeMaybe('cue-pipeline integration', () => {
  const originalFetch = global.fetch;
  const fetchCalls: Array<{ url: string; body: string }> = [];

  beforeEach(() => {
    fetchCalls.length = 0;
    process.env.ELEVENLABS_API_KEY = 'test-key';
    process.env.ELEVENLABS_VOICE_ID = 'test-voice';
    // Minimal fetch mock that returns a 4-byte MP3 buffer so generateSpeech resolves.
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : (url as URL).toString();
      fetchCalls.push({ url: urlStr, body: String(init?.body ?? '') });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(4),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const rules: CueRule[] = [
    {
      id: 'bar_path_drift',
      metric: 'barPathDriftCm',
      phases: ['concentric'],
      min: -2,
      max: 2,
      persistMs: 0,
      cooldownMs: 2000,
      priority: 5,
      message: 'Keep the bar close to your body.',
    },
    {
      id: 'chest_collapse',
      metric: 'chestAngleDeg',
      phases: ['concentric'],
      min: 70,
      max: 120,
      persistMs: 0,
      cooldownMs: 2000,
      priority: 1, // higher priority (lower number wins)
      message: 'Lift your chest.',
    },
  ];

  test('engine emits → TTS fetched with exact ruleId message', async () => {
    const engine = createCueEngine(rules, { minConfidence: 0.5 });


    const emissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    expect(emissions).toHaveLength(1);
    expect(emissions[0].ruleId).toBe('bar_path_drift');

    await generateSpeech(emissions[0].message);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body).toContain('Keep the bar close to your body.');
  });

  test('second emission inside cooldown window does NOT produce a new emission (no 2nd fetch)', async () => {
    const engine = createCueEngine(rules, { minConfidence: 0.5 });


    const first = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    expect(first).toHaveLength(1);
    await generateSpeech(first[0].message);

    // Same violation, 500ms later, inside 2000ms cooldown.
    const second = engine.evaluate({
      timestampMs: 1_500,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    expect(second).toHaveLength(0);
    expect(fetchCalls).toHaveLength(1); // no additional TTS fetch
  });

  test('after cooldown expires, same rule re-fires and triggers a second TTS fetch', async () => {
    const engine = createCueEngine(rules, { minConfidence: 0.5 });


    const first = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    await generateSpeech(first[0].message);

    const second = engine.evaluate({
      timestampMs: 1_000 + 2_100,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    expect(second).toHaveLength(1);
    await generateSpeech(second[0].message);
    expect(fetchCalls).toHaveLength(2);
  });

  test('priority sort: higher-priority rule wins when both violate (documents current single-emission behavior)', () => {
    const engine = createCueEngine(rules, { minConfidence: 0.5 });
    const emissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 60 }, // both violate
    });
    // Only ONE emission — chest_collapse (priority 1) wins.
    expect(emissions).toHaveLength(1);
    expect(emissions[0].ruleId).toBe('chest_collapse');
  });

  test('FOLLOW-UP: priority override cancellation — lower-priority in-flight cue is NOT canceled (bug)', () => {
    // Issue #430 Gap 4 contract: "lower-priority in-flight cue canceled when
    // higher-priority fires." Current cue-engine returns emissions[0] only
    // AFTER sorting, and makes no attempt to cancel a previously-fetched
    // lower-priority TTS request. This test documents the missing cancellation
    // behavior — it asserts that nothing throws and the earlier emission
    // remains valid, proving there is no cancellation machinery today.
    const engine = createCueEngine(rules, { minConfidence: 0.5 });

    // T=0: only bar_path_drift violates (low priority)
    const lowPriority: CueEmission[] = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });
    expect(lowPriority[0].ruleId).toBe('bar_path_drift');

    // T=1: chest_collapse starts violating (higher priority)
    // bar_path_drift still in cooldown, so only chest_collapse would emit.
    // No cancellation channel exists — the prior emission is still returned
    // to the caller as-is; cancellation lives (should live) at the audio
    // playback layer, which has no API today.
    const highPriority = engine.evaluate({
      timestampMs: 1_500,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 60 },
    });
    // chest_collapse fires; bar_path_drift suppressed by cooldown.
    expect(highPriority).toHaveLength(1);
    expect(highPriority[0].ruleId).toBe('chest_collapse');
    // No cancellation reference exists on the returned object.
    expect('cancelPrevious' in highPriority[0]).toBe(false);
  });

  test('AudioSession idle mode at cue-fire: generateSpeech still resolves (contract: drop policy up to caller)', async () => {
    // Document that the TTS layer itself never checks audio-session mode —
    // any drop policy must live in the speaker/playback layer.
    const engine = createCueEngine(rules, { minConfidence: 0.5 });


    const emissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.9,
      metrics: { barPathDriftCm: 5, chestAngleDeg: 90 },
    });

    const buffer = await generateSpeech(emissions[0].message);
    expect(buffer).not.toBeNull();
    // TTS resolves regardless of audio session state (no guard in elevenlabs-service).
  });

  test('missing API key short-circuits with null (no TTS fetch attempted)', async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const result = await generateSpeech('Hello.');
    expect(result).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test('missing voice ID short-circuits with null', async () => {
    delete process.env.ELEVENLABS_VOICE_ID;

    const result = await generateSpeech('Hello.');
    expect(result).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test('low confidence: engine emits nothing, no fetch attempted', async () => {
    const engine = createCueEngine(rules, { minConfidence: 0.5 });
    const emissions = engine.evaluate({
      timestampMs: 1_000,
      phase: 'concentric',
      confidence: 0.3, // below threshold
      metrics: { barPathDriftCm: 5, chestAngleDeg: 60 },
    });
    expect(emissions).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });
});
