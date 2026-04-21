/**
 * Tests for the voice-control pipeline master flag.
 */
import {
  VOICE_CONTROL_PIPELINE_ENV_VAR,
  isVoiceControlPipelineEnabled,
} from '@/lib/services/voice-pipeline-flag';

describe('voice-pipeline-flag', () => {
  const ORIGINAL = process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    } else {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = ORIGINAL;
    }
  });

  it('returns false when the env var is unset', () => {
    delete process.env[VOICE_CONTROL_PIPELINE_ENV_VAR];
    expect(isVoiceControlPipelineEnabled()).toBe(false);
  });

  it('returns true only for the literal string "on"', () => {
    process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = 'on';
    expect(isVoiceControlPipelineEnabled()).toBe(true);
  });

  it('returns false for falsy-looking values', () => {
    for (const value of ['off', 'false', '0', '', 'no']) {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = value;
      expect(isVoiceControlPipelineEnabled()).toBe(false);
    }
  });

  it('returns false for non-canonical truthy values (strict matching)', () => {
    for (const value of ['ON', 'On', 'true', '1', 'yes', 'enabled']) {
      process.env[VOICE_CONTROL_PIPELINE_ENV_VAR] = value;
      expect(isVoiceControlPipelineEnabled()).toBe(false);
    }
  });

  it('exports the env var name for callers that need to log it', () => {
    expect(VOICE_CONTROL_PIPELINE_ENV_VAR).toBe('EXPO_PUBLIC_VOICE_CONTROL_PIPELINE');
  });
});
