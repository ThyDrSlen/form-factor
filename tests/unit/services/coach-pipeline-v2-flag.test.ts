import { isCoachPipelineV2Enabled } from '@/lib/services/coach-pipeline-v2-flag';

const FLAG_ENV_VAR = 'EXPO_PUBLIC_COACH_PIPELINE_V2';

describe('coach-pipeline-v2-flag', () => {
  const originalValue = process.env[FLAG_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[FLAG_ENV_VAR];
    } else {
      process.env[FLAG_ENV_VAR] = originalValue;
    }
  });

  it('returns false when EXPO_PUBLIC_COACH_PIPELINE_V2 is unset', () => {
    delete process.env[FLAG_ENV_VAR];
    expect(isCoachPipelineV2Enabled()).toBe(false);
  });

  it('returns true when EXPO_PUBLIC_COACH_PIPELINE_V2 is "on"', () => {
    process.env[FLAG_ENV_VAR] = 'on';
    expect(isCoachPipelineV2Enabled()).toBe(true);
  });

  it('returns false when EXPO_PUBLIC_COACH_PIPELINE_V2 is "off"', () => {
    process.env[FLAG_ENV_VAR] = 'off';
    expect(isCoachPipelineV2Enabled()).toBe(false);
  });

  it('returns false for adjacent truthy-looking strings (strict parse)', () => {
    for (const value of ['true', '1', 'yes', 'ON', 'On', 'enabled', '']) {
      process.env[FLAG_ENV_VAR] = value;
      expect(isCoachPipelineV2Enabled()).toBe(false);
    }
  });

  it('returns false for whitespace-padded "on"', () => {
    process.env[FLAG_ENV_VAR] = ' on ';
    expect(isCoachPipelineV2Enabled()).toBe(false);
  });
});
