import { requireNativeModule } from 'expo-modules-core';
import { warnWithTs } from '@/lib/logger';
import { NativeSerializable, sanitizeForNative } from '@/lib/watch-connectivity/payload';

type WatchEventName = 'message' | 'reachability' | 'paired' | 'installed';
type WatchMessage = Record<string, unknown>;
type WatchContext = Record<string, unknown>;
type WatchEventPayloadMap = {
  message: WatchMessage;
  reachability: boolean;
  paired: boolean;
  installed: boolean;
};

type NativeSubscription = { remove?: () => void } | undefined | null;

type NativeModuleShape = {
  addListener?: (eventName: string, listener: (payload: unknown) => void) => NativeSubscription;
  sendMessage?: (payload: Record<string, NativeSerializable>) => void;
  updateApplicationContext?: (context: Record<string, NativeSerializable>) => void;
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
  addListener: <K extends WatchEventName>(event: K, cb: (arg: WatchEventPayloadMap[K]) => void) => {
    const nativeEventName = EVENT_MAP[event];
    const sub = Native?.addListener?.(nativeEventName, (payload: unknown) => {
      if (event === 'message') {
        const message = payload && typeof payload === 'object' ? (payload as WatchMessage) : {};
        cb(message as WatchEventPayloadMap[K]);
        return;
      }
      if (event === 'reachability') {
        const reachable = Boolean(
          payload && typeof payload === 'object' && 'reachable' in payload
            ? (payload as { reachable?: unknown }).reachable
            : false
        );
        cb(reachable as WatchEventPayloadMap[K]);
        return;
      }
      if (event === 'paired') {
        const paired = Boolean(
          payload && typeof payload === 'object' && 'paired' in payload
            ? (payload as { paired?: unknown }).paired
            : false
        );
        cb(paired as WatchEventPayloadMap[K]);
        return;
      }
      if (event === 'installed') {
        const installed = Boolean(
          payload && typeof payload === 'object' && 'installed' in payload
            ? (payload as { installed?: unknown }).installed
            : false
        );
        cb(installed as WatchEventPayloadMap[K]);
      }
    });
    return () => sub?.remove?.();
  },
  on: <K extends WatchEventName>(event: K, cb: (arg: WatchEventPayloadMap[K]) => void) => {
    return watchEvents.addListener(event, cb);
  },
};

export const sendMessage = (message: WatchMessage) => {
  const payload = sanitizeForNative(message);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Native?.sendMessage) return;
  Native.sendMessage(payload);
};

export const updateApplicationContext = (context: WatchContext) => {
  if (!Native?.updateApplicationContext) return;
  const payload = sanitizeForNative(context) ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) return;
  Native.updateApplicationContext(payload);
};

let latestWatchContext: WatchContext = {};

export function updateWatchContext(patch: Record<string, unknown | null | undefined>) {
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
