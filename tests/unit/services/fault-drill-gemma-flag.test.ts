import {
  isFaultDrillGemmaEnabled,
  FAULT_DRILL_GEMMA_FLAG_ENV_VAR,
} from '@/lib/services/fault-drill-gemma-flag';

describe('fault-drill-gemma-flag', () => {
  const originalValue = process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    } else {
      process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = originalValue;
    }
  });

  it('returns false when unset', () => {
    delete process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR];
    expect(isFaultDrillGemmaEnabled()).toBe(false);
  });

  it('returns true for "1"', () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = '1';
    expect(isFaultDrillGemmaEnabled()).toBe(true);
  });

  it('returns true for "true"', () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = 'true';
    expect(isFaultDrillGemmaEnabled()).toBe(true);
  });

  it('returns false for adjacent truthy-looking strings', () => {
    for (const value of ['yes', 'on', 'TRUE', 'True', 'ON', '0', 'false', 'enabled', '']) {
      process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = value;
      expect(isFaultDrillGemmaEnabled()).toBe(false);
    }
  });

  it('returns false for whitespace-padded values', () => {
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = ' 1 ';
    expect(isFaultDrillGemmaEnabled()).toBe(false);
    process.env[FAULT_DRILL_GEMMA_FLAG_ENV_VAR] = ' true ';
    expect(isFaultDrillGemmaEnabled()).toBe(false);
  });
});
