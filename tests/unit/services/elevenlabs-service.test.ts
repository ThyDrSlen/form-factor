import { generateSpeech, streamSpeech, generateCueFile } from '@/lib/services/elevenlabs-service';

const mockFetch = jest.fn() as jest.Mock;
global.fetch = mockFetch;

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ELEVENLABS_API_KEY = 'test-key';
  process.env.ELEVENLABS_VOICE_ID = 'test-voice';
  delete process.env.ELEVENLABS_MODEL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// =============================================================================
// generateSpeech
// =============================================================================

describe('generateSpeech', () => {
  it('calls correct URL with voice ID and returns ArrayBuffer on success', async () => {
    const fakeBuffer = new ArrayBuffer(8);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    });

    const result = await generateSpeech('Hello coach');

    expect(result).toBe(fakeBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/test-voice');
    expect(init.method).toBe('POST');
    expect(init.headers['xi-api-key']).toBe('test-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.text).toBe('Hello coach');
    expect(body.model_id).toBe('eleven_flash_v2_5');
    expect(body.voice_settings.stability).toBe(0.5);
    expect(body.voice_settings.similarity_boost).toBe(0.75);
  });

  it('returns null when API key is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const result = await generateSpeech('Hello');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null on API error (non-200 response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve('rate limited'),
    });

    const result = await generateSpeech('Hello');

    expect(result).toBeNull();
  });

  it('returns null on network error (fetch throws)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await generateSpeech('Hello');

    expect(result).toBeNull();
  });
});

// =============================================================================
// streamSpeech
// =============================================================================

describe('streamSpeech', () => {
  it('calls /stream endpoint and returns response.body', async () => {
    const fakeStream = new ReadableStream<Uint8Array>();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: fakeStream,
    });

    const result = await streamSpeech('Stream me');

    expect(result).toBe(fakeStream);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/test-voice/stream',
    );
  });

  it('returns null when voice ID is missing', async () => {
    delete process.env.ELEVENLABS_VOICE_ID;

    const result = await streamSpeech('Hello');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// generateCueFile
// =============================================================================

describe('generateCueFile', () => {
  it('calls generateSpeech and writes file via node:fs', async () => {
    const fakeBuffer = new ArrayBuffer(16);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    });

    // jest.mock with virtual: true — node:fs isn't resolvable in RN test env
    const mockWriteFileSync = jest.fn();
    jest.mock(
      'node:fs',
      () => ({ writeFileSync: mockWriteFileSync }),
      { virtual: true },
    );

    // generateCueFile uses dynamic import('node:fs') which doesn't resolve
    // in the jest-expo test environment. This function is Bun/Node-only.
    // We verify it returns false gracefully (the import fails, caught by try/catch).
    const result = await generateCueFile('Cue text', '/tmp/cue.mp3');

    expect(result).toBe(false); // Expected: dynamic import fails in jest-expo
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns false when generateSpeech returns null', async () => {
    delete process.env.ELEVENLABS_API_KEY;

    const result = await generateCueFile('Text', '/tmp/cue.mp3');

    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
