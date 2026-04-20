import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_FORM_TRACKING_SETTINGS,
  FQI_THRESHOLD_MAX,
  FQI_THRESHOLD_MIN,
  __resetForTests,
  clearExerciseOverride,
  loadSettings,
  resetToDefaults,
  resolveExerciseSettings,
  saveSettings,
  setExerciseOverride,
  updateSettings,
} from '@/lib/services/form-tracking-settings';

describe('form-tracking-settings', () => {
  beforeEach(async () => {
    await __resetForTests();
  });

  describe('defaults', () => {
    it('returns defaults when nothing is stored', async () => {
      const result = await loadSettings();
      expect(result.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
      expect(result.cueVerbosity).toBe('standard');
      expect(result.perExerciseOverrides).toEqual({});
    });

    it('returns defaults when stored JSON is corrupt', async () => {
      await AsyncStorage.setItem('form_tracking_settings_v1', '{notjson');
      const result = await loadSettings();
      expect(result.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });

    it('returns defaults when stored value is not an object', async () => {
      await AsyncStorage.setItem('form_tracking_settings_v1', JSON.stringify('nope'));
      const result = await loadSettings();
      expect(result.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });
  });

  describe('updateSettings', () => {
    it('persists a patched field and leaves others at defaults', async () => {
      const next = await updateSettings({ fqiThreshold: 0.85 });
      expect(next.fqiThreshold).toBe(0.85);
      expect(next.cueVerbosity).toBe('standard');
      const reloaded = await loadSettings();
      expect(reloaded.fqiThreshold).toBe(0.85);
    });

    it('clamps fqiThreshold above max', async () => {
      const next = await updateSettings({ fqiThreshold: 2.0 });
      expect(next.fqiThreshold).toBe(FQI_THRESHOLD_MAX);
    });

    it('clamps fqiThreshold below min', async () => {
      const next = await updateSettings({ fqiThreshold: -0.5 });
      expect(next.fqiThreshold).toBe(FQI_THRESHOLD_MIN);
    });

    it('rejects NaN and coerces to min', async () => {
      const next = await updateSettings({ fqiThreshold: Number.NaN });
      expect(next.fqiThreshold).toBe(FQI_THRESHOLD_MIN);
    });

    it('ignores unknown cueVerbosity values', async () => {
      const next = await updateSettings({ cueVerbosity: 'shouty' as never });
      expect(next.cueVerbosity).toBe('standard');
    });

    it('accepts valid cueVerbosity values', async () => {
      const next = await updateSettings({ cueVerbosity: 'minimal' });
      expect(next.cueVerbosity).toBe('minimal');
    });

    it('clamps overlayOpacity to [0.2, 1.0]', async () => {
      const high = await updateSettings({ overlayOpacity: 1.5 });
      expect(high.overlayOpacity).toBe(1.0);
      const low = await updateSettings({ overlayOpacity: 0.0 });
      expect(low.overlayOpacity).toBe(0.2);
    });

    it('toggles boolean flags independently', async () => {
      await updateSettings({ hapticsEnabled: false });
      await updateSettings({ voiceEnabled: true });
      const reloaded = await loadSettings();
      expect(reloaded.hapticsEnabled).toBe(false);
      expect(reloaded.voiceEnabled).toBe(true);
    });
  });

  describe('per-exercise overrides', () => {
    it('stores an override isolated from globals', async () => {
      await updateSettings({ fqiThreshold: 0.70 });
      await setExerciseOverride('squat', { fqiThreshold: 0.82 });
      const loaded = await loadSettings();
      expect(loaded.fqiThreshold).toBe(0.70);
      expect(loaded.perExerciseOverrides.squat).toEqual({ fqiThreshold: 0.82 });
    });

    it('merges additional keys into an existing override', async () => {
      await setExerciseOverride('deadlift', { fqiThreshold: 0.8 });
      await setExerciseOverride('deadlift', { cueVerbosity: 'detailed' });
      const loaded = await loadSettings();
      expect(loaded.perExerciseOverrides.deadlift).toEqual({
        fqiThreshold: 0.8,
        cueVerbosity: 'detailed',
      });
    });

    it('rejects empty exerciseId', async () => {
      await expect(setExerciseOverride('', { fqiThreshold: 0.8 })).rejects.toThrow(
        /exerciseId required/i,
      );
    });

    it('clampes override values the same as globals', async () => {
      await setExerciseOverride('pushup', { fqiThreshold: 1.5 });
      const loaded = await loadSettings();
      expect(loaded.perExerciseOverrides.pushup?.fqiThreshold).toBe(FQI_THRESHOLD_MAX);
    });

    it('clears an override by exerciseId', async () => {
      await setExerciseOverride('pullup', { fqiThreshold: 0.9 });
      await clearExerciseOverride('pullup');
      const loaded = await loadSettings();
      expect(loaded.perExerciseOverrides.pullup).toBeUndefined();
    });

    it('clearExerciseOverride is a no-op for unknown id', async () => {
      const before = await loadSettings();
      const after = await clearExerciseOverride('never-added');
      expect(after.perExerciseOverrides).toEqual(before.perExerciseOverrides);
    });

    it('drops empty overrides from persisted payload', async () => {
      await saveSettings({
        ...DEFAULT_FORM_TRACKING_SETTINGS,
        perExerciseOverrides: { row: {} },
      });
      const loaded = await loadSettings();
      expect(loaded.perExerciseOverrides.row).toBeUndefined();
    });
  });

  describe('resolveExerciseSettings', () => {
    it('returns globals when no exerciseId given', async () => {
      const settings = await loadSettings();
      const resolved = resolveExerciseSettings(settings, undefined);
      expect(resolved.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });

    it('returns globals when exercise has no override', async () => {
      const settings = await loadSettings();
      const resolved = resolveExerciseSettings(settings, 'bench-press');
      expect(resolved.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
    });

    it('applies per-exercise override on top of globals', async () => {
      await updateSettings({ fqiThreshold: 0.65, hapticsEnabled: false });
      await setExerciseOverride('squat', { fqiThreshold: 0.85 });
      const settings = await loadSettings();
      const resolved = resolveExerciseSettings(settings, 'squat');
      expect(resolved.fqiThreshold).toBe(0.85);
      expect(resolved.hapticsEnabled).toBe(false);
    });
  });

  describe('resetToDefaults', () => {
    it('wipes overrides and restores defaults', async () => {
      await updateSettings({ fqiThreshold: 0.9 });
      await setExerciseOverride('squat', { fqiThreshold: 0.5 });
      const after = await resetToDefaults();
      expect(after.fqiThreshold).toBe(DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold);
      expect(after.perExerciseOverrides).toEqual({});
    });
  });
});
