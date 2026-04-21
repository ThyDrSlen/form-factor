import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';

type PermState = { granted: boolean | null; canAskAgain: boolean | null };
let mockCurrentPermission: PermState = { granted: null, canAskAgain: true };
const mockGetPermission = jest.fn(async () => ({ ...mockCurrentPermission }));
const mockRequestPermission = jest.fn(async () => ({ ...mockCurrentPermission }));

jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [
    mockCurrentPermission,
    mockRequestPermission,
    mockGetPermission,
  ],
}));

import { useCameraPermissionGuard } from '@/hooks/use-camera-permission-guard';

type Listener = (state: AppStateStatus) => void;

function mockAppState() {
  const listeners: Listener[] = [];
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event: string, cb: Listener) => {
      if (event === 'change') listeners.push(cb);
      return { remove: () => {} } as { remove: () => void };
    });
  return {
    emit: (next: AppStateStatus) => {
      for (const l of listeners) l(next);
    },
    restore: () => spy.mockRestore(),
  };
}

describe('useCameraPermissionGuard', () => {
  beforeEach(() => {
    mockCurrentPermission = { granted: null, canAskAgain: true };
    mockGetPermission.mockClear();
    mockRequestPermission.mockClear();
  });

  it('reports granted when permission is granted', async () => {
    mockCurrentPermission = { granted: true, canAskAgain: true };
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(result.current.revoked).toBe(false);
    helper.restore();
  });

  it('flags revoked when granted transitions to not-granted', async () => {
    mockCurrentPermission = { granted: true, canAskAgain: true };
    const helper = mockAppState();
    const { result, rerender } = renderHook(() => useCameraPermissionGuard());
    await waitFor(() => expect(result.current.status).toBe('granted'));

    // User revokes in Settings, returns to app.
    mockCurrentPermission = { granted: false, canAskAgain: false };
    await act(async () => {
      helper.emit('active');
    });
    rerender({});
    await waitFor(() => expect(result.current.status).toBe('revoked'));
    expect(result.current.revoked).toBe(true);
    helper.restore();
  });

  it('reports denied (not revoked) when canAskAgain is still true and never granted', async () => {
    mockCurrentPermission = { granted: false, canAskAgain: true };
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.revoked).toBe(false);
    helper.restore();
  });

  it('openSettings delegates to Linking.openSettings on native', async () => {
    const spy = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    await act(async () => {
      await result.current.openSettings();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    helper.restore();
  });

  it('refresh re-queries the camera permission', async () => {
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockGetPermission).toHaveBeenCalled();
    helper.restore();
  });

  it('request calls requestPermission and returns the new status', async () => {
    mockCurrentPermission = { granted: false, canAskAgain: true };
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    mockCurrentPermission = { granted: true, canAskAgain: true };
    let nextStatus: string | undefined;
    await act(async () => {
      nextStatus = await result.current.request();
    });
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(nextStatus).toBe('granted');
    helper.restore();
  });

  // ---------------------------------------------------------------------------
  // Gap #12 — background→active revocation flow.
  //
  // Real-world flow: user grants camera on mount, backgrounds the app, flips
  // the permission off in Settings, then foregrounds. The hook must refresh
  // permission state on the `active` AppState transition and surface
  // `status: 'revoked'` so the scan UI can surface the "Open Settings" CTA.
  // ---------------------------------------------------------------------------

  it('granted → background → revoked in Settings → active re-fetches and flags revoked', async () => {
    mockCurrentPermission = { granted: true, canAskAgain: true };
    const helper = mockAppState();
    const { result } = renderHook(() => useCameraPermissionGuard());
    await waitFor(() => expect(result.current.status).toBe('granted'));

    // App backgrounds (no-op per current implementation, but we transition
    // through it for realism).
    await act(async () => {
      helper.emit('background');
    });
    // Status should not flip prematurely just on background.
    expect(result.current.status).toBe('granted');

    // User revokes in Settings; on foreground, refresh picks up the new state.
    mockCurrentPermission = { granted: false, canAskAgain: false };
    await act(async () => {
      helper.emit('active');
    });
    await waitFor(() => expect(result.current.status).toBe('revoked'));
    expect(result.current.revoked).toBe(true);
    expect(mockGetPermission).toHaveBeenCalled();

    helper.restore();
  });

  it('initial deny with canAskAgain=false exposes openSettings path (revoked semantics)', async () => {
    // This is the "irreversible deny" state — the app cannot re-prompt, so
    // the only recovery is the Settings deep link. The hook should report
    // revoked=true so the UI shows the correct CTA.
    mockCurrentPermission = { granted: false, canAskAgain: false };
    const helper = mockAppState();
    const { result } = renderHook(() =>
      useCameraPermissionGuard({ detectRevoke: true }),
    );
    await waitFor(() => expect(result.current.status).toBe('revoked'));
    expect(result.current.revoked).toBe(true);
    expect(result.current.canAskAgain).toBe(false);

    // The openSettings path must exist and be callable.
    expect(typeof result.current.openSettings).toBe('function');

    helper.restore();
  });

  it('detectRevoke=false on canAskAgain=false reports denied (not revoked)', async () => {
    // Without the revoke detection flag, the hook should degrade to plain
    // `denied` so legacy callers see no behavior change.
    mockCurrentPermission = { granted: false, canAskAgain: false };
    const helper = mockAppState();
    const { result } = renderHook(() =>
      useCameraPermissionGuard({ detectRevoke: false }),
    );
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.revoked).toBe(false);
    helper.restore();
  });
});
