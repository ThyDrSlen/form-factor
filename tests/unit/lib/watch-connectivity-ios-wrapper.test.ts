type ListenerMap = Record<string, (payload: any) => void>;

describe('watch-connectivity iOS wrapper', () => {
  let listeners: ListenerMap;
  let mockNative: any;

  beforeEach(() => {
    listeners = {};
    mockNative = {
      addListener: jest.fn((eventName: string, cb: (payload: any) => void) => {
        listeners[eventName] = cb;
        return { remove: jest.fn() };
      }),
      sendMessage: jest.fn(),
      updateApplicationContext: jest.fn(),
      getReachability: jest.fn(() => Promise.resolve(false)),
      getIsPaired: jest.fn(() => Promise.resolve(false)),
      getIsWatchAppInstalled: jest.fn(() => Promise.resolve(false)),
    };

    jest.resetModules();
    jest.doMock('expo-modules-core', () => ({
      requireNativeModule: () => mockNative,
    }));
  });

  it('sanitizes undefined fields before sending', () => {
    jest.isolateModules(() => {
      const { sendMessage } = require('@/lib/watch-connectivity.ios');
      sendMessage({ a: 1, b: undefined });
      expect(mockNative.sendMessage).toHaveBeenCalledWith({ a: 1 });
    });
  });

  it('merges watch context updates before pushing application context', () => {
    jest.isolateModules(() => {
      const { updateWatchContext, getLatestWatchContext } = require('@/lib/watch-connectivity.ios');

      updateWatchContext({ steps: 10 });
      updateWatchContext({ heartRate: 123 });

      expect(getLatestWatchContext()).toEqual({ steps: 10, heartRate: 123 });
      expect(mockNative.updateApplicationContext).toHaveBeenLastCalledWith({ steps: 10, heartRate: 123 });
    });
  });

  it('treats null values as deletes when updating watch context', () => {
    jest.isolateModules(() => {
      const { updateWatchContext, getLatestWatchContext } = require('@/lib/watch-connectivity.ios');

      updateWatchContext({ heartRate: 123 });
      updateWatchContext({ heartRate: null });

      expect(getLatestWatchContext()).toEqual({});
      expect(mockNative.updateApplicationContext).toHaveBeenLastCalledWith({});
    });
  });

  it('maps reachability event payload to boolean', () => {
    jest.isolateModules(() => {
      const { watchEvents } = require('@/lib/watch-connectivity.ios');
      const cb = jest.fn();
      watchEvents.addListener('reachability', cb);

      listeners['FFWatchConnectivity.reachability']?.({ reachable: true });
      expect(cb).toHaveBeenCalledWith(true);
    });
  });
});
