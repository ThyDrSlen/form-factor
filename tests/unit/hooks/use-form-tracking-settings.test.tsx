import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  __clearListenersForTests,
  useFormTrackingSettings,
} from '@/hooks/use-form-tracking-settings';
import {
  DEFAULT_FORM_TRACKING_SETTINGS,
  __resetForTests,
} from '@/lib/services/form-tracking-settings';

describe('useFormTrackingSettings', () => {
  beforeEach(async () => {
    await __resetForTests();
    __clearListenersForTests();
  });

  it('starts loading and hydrates with defaults', async () => {
    const { result } = renderHook(() => useFormTrackingSettings());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.fqiThreshold).toBe(
      DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold,
    );
  });

  it('update persists and broadcasts to siblings', async () => {
    const { result: a } = renderHook(() => useFormTrackingSettings());
    const { result: b } = renderHook(() => useFormTrackingSettings());
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));

    await act(async () => {
      await a.current.update({ fqiThreshold: 0.82 });
    });

    expect(a.current.settings.fqiThreshold).toBe(0.82);
    expect(b.current.settings.fqiThreshold).toBe(0.82);
  });

  it('setOverride + resolve returns global+override', async () => {
    const { result } = renderHook(() => useFormTrackingSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({ hapticsEnabled: false });
      await result.current.setOverride('squat', { fqiThreshold: 0.88 });
    });

    const resolved = result.current.resolve('squat');
    expect(resolved.fqiThreshold).toBe(0.88);
    expect(resolved.hapticsEnabled).toBe(false);
  });

  it('clearOverride removes the override', async () => {
    const { result } = renderHook(() => useFormTrackingSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setOverride('row', { fqiThreshold: 0.9 });
    });
    expect(result.current.settings.perExerciseOverrides.row).toBeDefined();

    await act(async () => {
      await result.current.clearOverride('row');
    });
    expect(result.current.settings.perExerciseOverrides.row).toBeUndefined();
  });

  it('reset returns to defaults', async () => {
    const { result } = renderHook(() => useFormTrackingSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update({ fqiThreshold: 0.92 });
      await result.current.reset();
    });

    expect(result.current.settings.fqiThreshold).toBe(
      DEFAULT_FORM_TRACKING_SETTINGS.fqiThreshold,
    );
  });

  it('unmount detaches listener so updates do not leak', async () => {
    const { result: a, unmount: unmountA } = renderHook(() => useFormTrackingSettings());
    const { result: b } = renderHook(() => useFormTrackingSettings());
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));

    const aInitial = a.current.settings.fqiThreshold;
    unmountA();

    await act(async () => {
      await b.current.update({ fqiThreshold: 0.77 });
    });

    // b updated; a captured value never changed post-unmount (still equals initial).
    expect(b.current.settings.fqiThreshold).toBe(0.77);
    expect(a.current.settings.fqiThreshold).toBe(aInitial);
  });
});
