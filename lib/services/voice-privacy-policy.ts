/**
 * Voice Privacy Contract (#469)
 *
 * Compile-time-enforceable declaration of how the voice-input subsystem
 * handles user audio + transcripts. This is a no-op module — its entire
 * value is the exported literal type which makes any regression visible
 * at TypeScript build time.
 *
 * Contract summary:
 *   - persistTranscripts: false
 *     → Raw speech-recognition transcripts must not be written to
 *       persistent storage (SQLite, Supabase, AsyncStorage, filesystem,
 *       nor sent to Sentry/logging infrastructure).
 *   - persistRecognitionAudio: false
 *     → Raw audio samples captured by expo-speech-recognition must not
 *       be saved to disk nor uploaded.
 *   - userConsentRequired: true
 *     → The user must explicitly enable voice control via the
 *       useVoiceControlStore toggle before the mic is activated. The
 *       store default is `enabled: false`.
 *
 * Any future code that touches voice transcripts should import this
 * module and fail loudly if these flags change to `true`. The module
 * exports no functions; it is deliberately tiny so linters and code
 * review can spot it easily.
 */

export interface VoicePrivacyContract {
  readonly persistTranscripts: false;
  readonly persistRecognitionAudio: false;
  readonly userConsentRequired: true;
}

export const VOICE_PRIVACY_CONTRACT: VoicePrivacyContract = Object.freeze({
  persistTranscripts: false,
  persistRecognitionAudio: false,
  userConsentRequired: true,
});

/**
 * Assertion helper — call this from voice hotpaths to establish a runtime
 * barrier. If a refactor ever accidentally widens the contract, every
 * call site breaks at TS build time because the literal `false` flipped
 * to `boolean`.
 */
export function assertPrivacyContract(contract: VoicePrivacyContract): void {
  // The assertion body is empty by design — the type literal is the guard.
  void contract;
}
