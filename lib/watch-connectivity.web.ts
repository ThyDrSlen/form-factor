import { logWithTs } from '@/lib/logger';

const noop = () => {};

type WatchEventName = 'message' | 'reachability' | 'paired' | 'installed';
type WatchMessage = Record<string, unknown>;
type WatchContext = Record<string, unknown>;
type WatchEventPayloadMap = {
  message: WatchMessage;
  reachability: boolean;
  paired: boolean;
  installed: boolean;
};

let latestWatchContext: WatchContext = {};

export const watchEvents = {
  addListener: <K extends WatchEventName>(_event: K, _cb: (message: WatchEventPayloadMap[K]) => void) => noop,
  on: <K extends WatchEventName>(_event: K, _cb: (message: WatchEventPayloadMap[K]) => void) => noop,
};

export const sendMessage = (message: WatchMessage) => {
  logWithTs('[WatchConnectivity Mock] sendMessage:', message);
};

export const updateApplicationContext = (context: WatchContext) => {
  latestWatchContext = context ?? {};
  logWithTs('[WatchConnectivity Mock] updateApplicationContext:', context);
};

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

export const getReachability = () => Promise.resolve(false);
export const getIsPaired = () => Promise.resolve(false);
export const getIsWatchAppInstalled = () => Promise.resolve(false);
