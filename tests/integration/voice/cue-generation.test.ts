export {};

const skipCueTests = process.env.SKIP_VOICE_TESTS === '1' ||
  !process.env.ELEVENLABS_API_KEY ||
  !process.env.ELEVENLABS_VOICE_ID;

const describeCue = skipCueTests ? describe.skip : describe;

describeCue('Cue Audio Generation', () => {
  const TIMEOUT = 20_000;

  it('generates an MP3 file for a real form cue', async () => {
    const { generateCueFile } = await import('@/lib/services/elevenlabs-node');
    const { existsSync, unlinkSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const outputPath = join(tmpdir(), `cue-gen-test-${Date.now()}.mp3`);

    try {
      const result = await generateCueFile(
        'Pull higher to bring your chin past the bar.',
        outputPath,
      );

      expect(result).toBe(true);
      expect(existsSync(outputPath)).toBe(true);

      const stats = statSync(outputPath);
      expect(stats.size).toBeGreaterThan(1000);
      console.log(`[CueGen] Generated MP3: ${stats.size} bytes`);
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
    }
  }, TIMEOUT);

  it('generates different audio for different cues', async () => {
    const { generateSpeech } = await import('@/lib/services/elevenlabs-service');

    const [cue1, cue2] = await Promise.all([
      generateSpeech('Keep your back straight.'),
      generateSpeech('Fully extend your arms.'),
    ]);

    expect(cue1).not.toBeNull();
    expect(cue2).not.toBeNull();
    expect(cue1!.byteLength).not.toBe(cue2!.byteLength);
  }, TIMEOUT);
});
