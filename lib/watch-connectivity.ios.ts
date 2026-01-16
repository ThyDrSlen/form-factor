import { requireNativeModule } from 'expo-modules-core';
import { warnWithTs } from '@/lib/logger';
import { sanitizeForNative } from '@/lib/watch-connectivity/payload';

type WatchEventName = 'message' | 'reachability' | 'paired' | 'installed';

type NativeSubscription = { remove?: () => void } | undefined | null;

type NativeModuleShape = {
  addListener?: (eventName: string, listener: (payload: any) => void) => NativeSubscription;
  sendMessage?: (payload: Record<string, any>) => void;
  updateApplicationContext?: (context: Record<string, any>) => void;
  getReachability?: () => Promise<boolean>;
  getIsPaired?: () => Promise<boolean>;
  getIsWatchAppInstalled?: () => Promise<boolean>;
};

const EVENT_MAP: Record<WatchEventName, string> = {
  message: 'FFWatchConnectivity.message',
  reachability: 'FFWatchConnectivity.reachability',
  paired: 'FFWatchConnectivity.paired',
  installed: 'FFWatchConnectivity.installed',
};

let Native: NativeModuleShape | null = null;
try {
  Native = requireNativeModule('FFWatchConnectivity');
} catch (error) {
  warnWithTs('[watch-connectivity] FFWatchConnectivity native module not available', error);
  Native = null;
}

export const watchEvents = {
  addListener: (event: WatchEventName, cb: (arg: any) => void) => {
    const nativeEventName = EVENT_MAP[event];
    const sub = Native?.addListener?.(nativeEventName, (payload: any) => {
      if (event === 'message') return cb(payload ?? {});
      if (event === 'reachability') return cb(!!payload?.reachable);
      if (event === 'paired') return cb(!!payload?.paired);
      if (event === 'installed') return cb(!!payload?.installed);
      return cb(payload);
    });
    return () => sub?.remove?.();
  },
  on: (event: WatchEventName, cb: (arg: any) => void) => {
    return (watchEvents as any).addListener(event, cb);
  },
};

export const sendMessage = (message: any) => {
  const payload = sanitizeForNative(message);
  if (!payload || !Native?.sendMessage) return;
  Native.sendMessage(payload);
};

export const updateApplicationContext = (context: any) => {
  if (!Native?.updateApplicationContext) return;
  const payload = sanitizeForNative(context) ?? {};
  Native.updateApplicationContext(payload);
};

let latestWatchContext: Record<string, any> = {};

export function updateWatchContext(patch: Record<string, any>) {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) {
      delete latestWatchContext[key];
      continue;
    }
    if (value !== undefined) {
      latestWatchContext[key] = value;
    }
  }
  updateApplicationContext(latestWatchContext);
}

export function getLatestWatchContext() {
  return latestWatchContext;
}

export const getReachability = () => Native?.getReachability?.() ?? Promise.resolve(false);
export const getIsPaired = () => Native?.getIsPaired?.() ?? Promise.resolve(false);
export const getIsWatchAppInstalled = () => Native?.getIsWatchAppInstalled?.() ?? Promise.resolve(false);
