import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useAppStatePause } from '@/hooks/use-app-state-pause';

type Listener = (state: AppStateStatus) => void;

function mockAppState() {
  const listeners: Listener[] = [];
  const addSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event: string, cb: Listener) => {
      if (event === 'change') listeners.push(cb);
      return { remove: () => {} } as { remove: () => void };
    });
  return {
    emit: (state: AppStateStatus) => {
      for (const l of listeners) l(state);
    },
    restore: () => addSpy.mockRestore(),
  };
}

describe('useAppStatePause', () => {
  it('starts unpaused', () => {
    const helper = mockAppState();
    const { result } = renderHook(() => useAppStatePause());
    expect(result.current.isPaused).toBe(false);
    expect(result.current.needsResume).toBe(false);
    helper.restore();
  });

  it('marks paused on background transition', () => {
    const helper = mockAppState();
    const onPause = jest.fn();
    const { result } = renderHook(() => useAppStatePause({ onPause }));
    act(() => helper.emit('background'));
    expect(result.current.isPaused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    helper.restore();
  });

  it('sets needsResume (not auto-resume) on foreground return', () => {
    const helper = mockAppState();
    const onForeground = jest.fn();
    const { result } = renderHook(() => useAppStatePause({ onForeground }));
    act(() => helper.emit('background'));
    act(() => helper.emit('active'));
    expect(result.current.isPaused).toBe(true);
    expect(result.current.needsResume).toBe(true);
    expect(onForeground).toHaveBeenCalledTimes(1);
    helper.restore();
  });

  it('resume() clears both flags', () => {
    const helper = mockAppState();
    const { result } = renderHook(() => useAppStatePause());
    act(() => helper.emit('background'));
    act(() => helper.emit('active'));
    act(() => {
      result.current.resume();
    });
    expect(result.current.isPaused).toBe(false);
    expect(result.current.needsResume).toBe(false);
    helper.restore();
  });

  it('markPaused() flips isPaused without needing an AppState event', () => {
    const helper = mockAppState();
    const { result } = renderHook(() => useAppStatePause());
    act(() => {
      result.current.markPaused();
    });
    expect(result.current.isPaused).toBe(true);
    helper.restore();
  });

  it('does not attach listener when disabled', () => {
    const addSpy = jest.spyOn(AppState, 'addEventListener');
    renderHook(() => useAppStatePause({ enabled: false }));
    expect(addSpy).not.toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    addSpy.mockRestore();
  });
});
