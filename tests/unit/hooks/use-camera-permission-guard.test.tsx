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
});
