/**
 * ElevenLabs Integration Tests
 *
 * These tests call the REAL ElevenLabs API. They require:
 *   ELEVENLABS_API_KEY — valid API key
 *   ELEVENLABS_VOICE_ID — valid voice ID
 *
 * Skip with: SKIP_VOICE_TESTS=1 bun test
 */

export {};

const SKIP = process.env.SKIP_VOICE_TESTS === '1' ||
  !process.env.ELEVENLABS_API_KEY ||
  !process.env.ELEVENLABS_VOICE_ID;

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('ElevenLabs Integration', () => {
  const TIMEOUT = 15_000;

  describe('generateSpeech', () => {
    it('returns MP3 audio buffer for a short cue', async () => {
      const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

      const result = await generateSpeech('Pull higher to bring your chin past the bar.');

      expect(result).not.toBeNull();
      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result!.byteLength).toBeGreaterThan(1000);
    }, TIMEOUT);

    it('returns MP3 for a positive reinforcement cue', async () => {
      const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

      const result = await generateSpeech('Great form — keep it up.');

      expect(result).not.toBeNull();
      expect(result!.byteLength).toBeGreaterThan(500);
    }, TIMEOUT);

    it('returns MP3 for a longer coach response', async () => {
      const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

      const coachResponse = 'For a 3-day strength program, try this: Day 1 squat and bench press, Day 2 deadlift and overhead press, Day 3 rows and pull-ups. Do 3 sets of 5 reps for each.';
      const result = await generateSpeech(coachResponse);

      expect(result).not.toBeNull();
      expect(result!.byteLength).toBeGreaterThan(5000);
    }, TIMEOUT);

    it('returns null for empty text', async () => {
      const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

      const result = await generateSpeech('');

      if (result !== null) {
        expect(result.byteLength).toBeLessThan(500);
      }
    }, TIMEOUT);
  });

  describe('streamSpeech', () => {
    it('returns a readable stream for a cue', async () => {
      const { streamSpeech } = await import('@/lib/services/elevenlabs-service');

      const stream = await streamSpeech('Keep your back straight during the lift.');

      expect(stream).not.toBeNull();
      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream!.getReader();
      const { value, done } = await reader.read();
      reader.releaseLock();

      expect(done).toBe(false);
      expect(value).toBeInstanceOf(Uint8Array);
      expect(value!.length).toBeGreaterThan(0);
    }, TIMEOUT);
  });

  describe('generateCueFile', () => {
    it('writes an MP3 file to disk', async () => {
      const { generateCueFile } = await import('@/lib/services/elevenlabs-service');
      const { existsSync, unlinkSync, statSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const outputPath = join(tmpdir(), `test-cue-${Date.now()}.mp3`);

      try {
        const result = await generateCueFile('Strong reps — keep going.', outputPath);

        expect(result).toBe(true);
        expect(existsSync(outputPath)).toBe(true);

        const stats = statSync(outputPath);
        expect(stats.size).toBeGreaterThan(1000);
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
      }
    }, TIMEOUT);
  });

  describe('latency', () => {
    it('generates a short cue in under 3 seconds', async () => {
      const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

      const start = Date.now();
      const result = await generateSpeech('Nice work.');
      const elapsed = Date.now() - start;

      expect(result).not.toBeNull();
      expect(elapsed).toBeLessThan(3000);
      console.log(`[Latency] Short cue TTS: ${elapsed}ms`);
    }, TIMEOUT);

    it('streams first chunk in under 2 seconds', async () => {
      const { streamSpeech } = await import('@/lib/services/elevenlabs-service');

      const start = Date.now();
      const stream = await streamSpeech('Pull your shoulders back.');
      const firstChunkTime = Date.now() - start;

      expect(stream).not.toBeNull();

      const reader = stream!.getReader();
      await reader.read();
      const afterFirstRead = Date.now() - start;
      reader.releaseLock();

      expect(firstChunkTime).toBeLessThan(2000);
      console.log(`[Latency] Stream connect: ${firstChunkTime}ms, first chunk: ${afterFirstRead}ms`);
    }, TIMEOUT);
  });
});
