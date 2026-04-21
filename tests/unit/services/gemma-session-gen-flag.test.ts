import {
  GEMMA_SESSION_GEN_ENV_VAR,
  FLAG_DISABLED_ERROR_CODE,
  GemmaSessionGenDisabledError,
  assertGemmaSessionGenEnabled,
  isGemmaSessionGenEnabled,
} from '@/lib/services/gemma-session-gen-flag';

const ENV_VAR = 'EXPO_PUBLIC_GEMMA_SESSION_GEN';

describe('gemma-session-gen-flag', () => {
  const originalValue = process.env[ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalValue;
    }
  });

  describe('isGemmaSessionGenEnabled', () => {
    it('returns false when the env var is unset', () => {
      delete process.env[ENV_VAR];
      expect(isGemmaSessionGenEnabled()).toBe(false);
    });

    it('returns true for the literal "on" token', () => {
      process.env[ENV_VAR] = 'on';
      expect(isGemmaSessionGenEnabled()).toBe(true);
    });

    it('returns true for the literal "1" token', () => {
      process.env[ENV_VAR] = '1';
      expect(isGemmaSessionGenEnabled()).toBe(true);
    });

    it('returns true for the literal "true" token', () => {
      process.env[ENV_VAR] = 'true';
      expect(isGemmaSessionGenEnabled()).toBe(true);
    });

    it('is case-insensitive on the enabled side', () => {
      for (const value of ['On', 'ON', 'TRUE', 'True']) {
        process.env[ENV_VAR] = value;
        expect(isGemmaSessionGenEnabled()).toBe(true);
      }
    });

    it('trims whitespace before matching', () => {
      process.env[ENV_VAR] = '  on  ';
      expect(isGemmaSessionGenEnabled()).toBe(true);
    });

    it('returns false for "off"', () => {
      process.env[ENV_VAR] = 'off';
      expect(isGemmaSessionGenEnabled()).toBe(false);
    });

    it('returns false for empty and unknown tokens', () => {
      for (const value of ['', '0', 'false', 'yes', 'no', 'enabled']) {
        process.env[ENV_VAR] = value;
        expect(isGemmaSessionGenEnabled()).toBe(false);
      }
    });
  });

  describe('exports', () => {
    it('exposes the env var name as a string constant', () => {
      expect(GEMMA_SESSION_GEN_ENV_VAR).toBe(ENV_VAR);
    });

    it('exposes a stable disabled error code', () => {
      expect(FLAG_DISABLED_ERROR_CODE).toBe('GEMMA_SESSION_GEN_DISABLED');
    });
  });

  describe('assertGemmaSessionGenEnabled', () => {
    it('throws GemmaSessionGenDisabledError when flag is off', () => {
      delete process.env[ENV_VAR];
      expect(() => assertGemmaSessionGenEnabled('test-surface')).toThrow(
        GemmaSessionGenDisabledError,
      );
    });

    it('includes the surface label in the error message', () => {
      delete process.env[ENV_VAR];
      try {
        assertGemmaSessionGenEnabled('session-generator');
        fail('expected error');
      } catch (err) {
        expect((err as Error).message).toContain('session-generator');
        expect((err as GemmaSessionGenDisabledError).code).toBe(
          FLAG_DISABLED_ERROR_CODE,
        );
        expect((err as GemmaSessionGenDisabledError).envVar).toBe(ENV_VAR);
      }
    });

    it('does not throw when flag is on', () => {
      process.env[ENV_VAR] = 'on';
      expect(() => assertGemmaSessionGenEnabled('session-generator')).not.toThrow();
    });
  });
});
