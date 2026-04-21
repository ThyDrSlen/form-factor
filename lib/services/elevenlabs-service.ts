/**
 * ElevenLabs TTS API client — fetch-based, no SDK dependency.
 *
 * Env vars:
 *   ELEVENLABS_API_KEY   — required
 *   ELEVENLABS_VOICE_ID  — default voice
 *   ELEVENLABS_MODEL     — default "eleven_flash_v2_5"
 */

const BASE_URL = 'https://api.elevenlabs.io/v1';

function getConfig() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY ?? '',
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? '',
    model: process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5',
  };
}

export interface ElevenLabsOptions {
  voiceId?: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
}

function buildBody(text: string, options: ElevenLabsOptions | undefined) {
  const config = getConfig();
  return JSON.stringify({
    text,
    model_id: options?.model ?? config.model,
    voice_settings: {
      stability: options?.stability ?? 0.5,
      similarity_boost: options?.similarityBoost ?? 0.75,
    },
  });
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
  };
}

function resolveVoiceId(options: ElevenLabsOptions | undefined): string {
  return options?.voiceId ?? getConfig().voiceId;
}

/**
 * Single-shot TTS — returns ArrayBuffer of MP3 audio, or null on error.
 */
export async function generateSpeech(
  text: string,
  options?: ElevenLabsOptions,
): Promise<ArrayBuffer | null> {
  const { apiKey } = getConfig();
  if (!apiKey) {
    console.warn('[ElevenLabs] Missing ELEVENLABS_API_KEY');
    return null;
  }

  const voiceId = resolveVoiceId(options);
  if (!voiceId) {
    console.warn('[ElevenLabs] Missing voice ID');
    return null;
  }

  try {
    const response = await fetch(
      `${BASE_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: buildBody(text, options),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[ElevenLabs] API error ${response.status}: ${errorText}`,
      );
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.warn('[ElevenLabs]', error);
    return null;
  }
}

/**
 * Streaming TTS — returns ReadableStream of audio chunks, or null on error.
 */
export async function streamSpeech(
  text: string,
  options?: ElevenLabsOptions,
): Promise<ReadableStream<Uint8Array> | null> {
  const { apiKey } = getConfig();
  if (!apiKey) {
    console.warn('[ElevenLabs] Missing ELEVENLABS_API_KEY');
    return null;
  }

  const voiceId = resolveVoiceId(options);
  if (!voiceId) {
    console.warn('[ElevenLabs] Missing voice ID');
    return null;
  }

  try {
    const response = await fetch(
      `${BASE_URL}/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: buildBody(text, options),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[ElevenLabs] Streaming API error ${response.status}: ${errorText}`,
      );
      return null;
    }

    return response.body ?? null;
  } catch (error) {
    console.warn('[ElevenLabs]', error);
    return null;
  }
}

/**
 * Generate MP3 to a file path (for build scripts — Node.js / Bun only).
 * Returns true on success, false on error.
 *
 * NOTE: This helper lives in scripts/generate-cue-audio.ts, not here.
 * Putting filesystem writes in this file pulled `node:fs` into the Metro
 * bundle (via `import('node:fs')`), which landed in main.jsbundle and
 * broke Xcode's App Intents metadata extractor.
 */
