/**
 * coach-vision tests
 *
 * Covers:
 * - encodeJpegToBase64: happy path + validation / missing-file errors
 * - composeVisionPrompt: multimodal shape, fallbacks, user-note cap
 * - dispatchVisionRequest: flag-off skip, flag-on delegate, provider
 *   fallback pass-through
 */

// expo-file-system's runtime pulls in Expo native modules that aren't
// loaded in jest-expo's default setup. Mock the File class directly so we
// can control `exists` and `base64()` per test.
const mockBase64 = jest.fn();
const mockExistsGetter = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    get exists() {
      return mockExistsGetter();
    },
    base64: mockBase64,
  })),
}));

import {
  composeVisionPrompt,
  dispatchVisionRequest,
  encodeJpegToBase64,
  type VisionMessage,
} from '@/lib/services/coach-vision';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_VISION';

describe('coach-vision', () => {
  const originalFlag = process.env[FLAG_ENV_VAR];

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsGetter.mockReturnValue(true);
    mockBase64.mockResolvedValue('BASE64_DATA');
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalFlag;
    }
  });

  // ---------------------------------------------------------------------------
  // encodeJpegToBase64
  // ---------------------------------------------------------------------------

  describe('encodeJpegToBase64', () => {
    it('returns the base64 string from the File API', async () => {
      mockBase64.mockResolvedValue('JPEG_B64');
      const result = await encodeJpegToBase64('file:///tmp/snap.jpg');
      expect(result).toBe('JPEG_B64');
      expect(mockBase64).toHaveBeenCalledTimes(1);
    });

    it('throws when uri is empty or whitespace', async () => {
      await expect(encodeJpegToBase64('')).rejects.toThrow(/uri is required/);
      await expect(encodeJpegToBase64('   ')).rejects.toThrow(/uri is required/);
    });

    it('throws when uri is not a string', async () => {
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        encodeJpegToBase64(undefined as unknown as string),
      ).rejects.toThrow(/uri is required/);
      await expect(
        encodeJpegToBase64(null as unknown as string),
      ).rejects.toThrow(/uri is required/);
    });

    it('throws a descriptive error when the file does not exist', async () => {
      mockExistsGetter.mockReturnValue(false);
      await expect(
        encodeJpegToBase64('file:///tmp/missing.jpg'),
      ).rejects.toThrow(/file not found at file:\/\/\/tmp\/missing\.jpg/);
      expect(mockBase64).not.toHaveBeenCalled();
    });

    it('propagates IO errors from the File API', async () => {
      mockBase64.mockRejectedValue(new Error('read failed'));
      await expect(
        encodeJpegToBase64('file:///tmp/broken.jpg'),
      ).rejects.toThrow(/read failed/);
    });
  });

  // ---------------------------------------------------------------------------
  // composeVisionPrompt
  // ---------------------------------------------------------------------------

  describe('composeVisionPrompt', () => {
    it('builds a user message with text + image parts in order', () => {
      const msg = composeVisionPrompt({
        exercise: 'squat',
        phase: 'bottom',
        base64Image: 'XYZ',
      });
      expect(msg.role).toBe('user');
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('squat'),
      });
      expect(msg.content[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('bottom'),
      });
      expect(msg.content[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: 'XYZ',
        },
      });
    });

    it('preserves the exact exercise and phase strings (no mapping)', () => {
      const msg = composeVisionPrompt({
        exercise: 'romanian-deadlift',
        phase: 'eccentric',
        base64Image: '',
      });
      const text = (msg.content[0] as { text: string }).text;
      expect(text).toContain('romanian-deadlift');
      expect(text).toContain('eccentric');
    });

    it('falls back to "lift" / "setup" when exercise or phase are empty', () => {
      const msg = composeVisionPrompt({
        exercise: '',
        phase: '',
        base64Image: 'Q',
      });
      const text = (msg.content[0] as { text: string }).text;
      expect(text).toContain('lift');
      expect(text).toContain('setup');
    });

    it('appends the user note when provided', () => {
      const msg = composeVisionPrompt({
        exercise: 'pullup',
        phase: 'top',
        base64Image: 'IMG',
        userNote: 'Feels like my elbows flare',
      });
      const text = (msg.content[0] as { text: string }).text;
      expect(text).toContain('User note: Feels like my elbows flare');
    });

    it('omits the user-note clause when the note is blank', () => {
      const msg = composeVisionPrompt({
        exercise: 'pullup',
        phase: 'top',
        base64Image: 'IMG',
        userNote: '   ',
      });
      const text = (msg.content[0] as { text: string }).text;
      expect(text).not.toContain('User note');
    });

    it('caps the user note at 240 characters', () => {
      const longNote = 'a'.repeat(400);
      const msg = composeVisionPrompt({
        exercise: 'squat',
        phase: 'bottom',
        base64Image: 'IMG',
        userNote: longNote,
      });
      const text = (msg.content[0] as { text: string }).text;
      const notePart = text.split('User note: ')[1] ?? '';
      expect(notePart.length).toBe(240);
    });

    it('passes the raw base64 through verbatim (no re-encoding)', () => {
      const msg = composeVisionPrompt({
        exercise: 'squat',
        phase: 'top',
        base64Image: 'iVBORw0KGgoAAAANS',
      });
      expect(msg.content[1]).toMatchObject({
        type: 'image',
        source: { data: 'iVBORw0KGgoAAAANS' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // dispatchVisionRequest
  // ---------------------------------------------------------------------------

  describe('dispatchVisionRequest', () => {
    const sampleMessage: VisionMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Critique my squat.' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: 'IMG' },
        },
      ],
    };

    it('skips with flag-off reason when env flag is unset', () => {
      delete process.env[FLAG_ENV_VAR];
      const result = dispatchVisionRequest(sampleMessage);
      expect(result).toEqual({ skipped: true, reason: 'flag-off' });
    });

    it('skips with flag-off reason when env flag is off', () => {
      process.env[FLAG_ENV_VAR] = 'off';
      const result = dispatchVisionRequest(sampleMessage);
      expect(result).toEqual({ skipped: true, reason: 'flag-off' });
    });

    it('explicit flag:false override still skips', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const result = dispatchVisionRequest(sampleMessage, { flag: false });
      expect(result).toEqual({ skipped: true, reason: 'flag-off' });
    });

    it('flag:true override sends even when env is unset', () => {
      delete process.env[FLAG_ENV_VAR];
      const result = dispatchVisionRequest(sampleMessage, { flag: true });
      expect(result.skipped).toBe(false);
      if (result.skipped === false) {
        expect(result.decision.model).toBe('gemma-4-31b-it');
        expect(result.decision.reason).toBe('vision_gemma');
      }
    });

    it('delegates to coach-model-dispatch for form_vision_check when flag is on', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const result = dispatchVisionRequest(sampleMessage);
      expect(result.skipped).toBe(false);
      if (result.skipped === false) {
        expect(result.decision).toEqual({
          model: 'gemma-4-31b-it',
          reason: 'vision_gemma',
          fellBackToCloud: false,
        });
        expect(result.provider).toBe('gemma');
        expect(result.message).toBe(sampleMessage);
      }
    });

    it('honors fallbackToCloud by downgrading to gpt-5.4-mini', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const result = dispatchVisionRequest(sampleMessage, {
        fallbackToCloud: true,
      });
      expect(result.skipped).toBe(false);
      if (result.skipped === false) {
        expect(result.decision.model).toBe('gpt-5.4-mini');
        expect(result.decision.reason).toBe('vision_fallback_cloud');
        expect(result.decision.fellBackToCloud).toBe(true);
      }
    });

    it('uses provided userTier (does not affect form_vision_check model choice)', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const free = dispatchVisionRequest(sampleMessage, { userTier: 'free' });
      const premium = dispatchVisionRequest(sampleMessage, {
        userTier: 'premium',
      });
      if (free.skipped === false && premium.skipped === false) {
        expect(free.decision.model).toBe('gemma-4-31b-it');
        expect(premium.decision.model).toBe('gemma-4-31b-it');
      }
    });

    it('honors explicit provider option', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const result = dispatchVisionRequest(sampleMessage, {
        provider: 'openai',
      });
      if (result.skipped === false) {
        expect(result.provider).toBe('openai');
      }
    });

    it('defaults provider to gemma when not supplied', () => {
      process.env[FLAG_ENV_VAR] = 'on';
      const result = dispatchVisionRequest(sampleMessage);
      if (result.skipped === false) {
        expect(result.provider).toBe('gemma');
      }
    });
  });
});
