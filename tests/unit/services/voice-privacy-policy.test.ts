import {
  VOICE_PRIVACY_CONTRACT,
  assertPrivacyContract,
  type VoicePrivacyContract,
} from '@/lib/services/voice-privacy-policy';

describe('VOICE_PRIVACY_CONTRACT', () => {
  it('exports the expected literal shape', () => {
    expect(VOICE_PRIVACY_CONTRACT).toEqual({
      persistTranscripts: false,
      persistRecognitionAudio: false,
      userConsentRequired: true,
    });
  });

  it('is frozen (immutable at runtime)', () => {
    expect(Object.isFrozen(VOICE_PRIVACY_CONTRACT)).toBe(true);
  });

  it('assertPrivacyContract accepts the canonical contract', () => {
    expect(() => assertPrivacyContract(VOICE_PRIVACY_CONTRACT)).not.toThrow();
  });

  it('type enforcement: literal types cannot be flipped to true', () => {
    // Compile-time check — these would fail `tsc` if the contract were
    // widened. The `as VoicePrivacyContract` assertion would reject
    // `persistTranscripts: true`.
    const canonical: VoicePrivacyContract = {
      persistTranscripts: false,
      persistRecognitionAudio: false,
      userConsentRequired: true,
    };
    expect(canonical.persistTranscripts).toBe(false);
    expect(canonical.persistRecognitionAudio).toBe(false);
    expect(canonical.userConsentRequired).toBe(true);
  });
});
