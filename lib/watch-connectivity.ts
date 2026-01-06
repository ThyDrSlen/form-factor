const noop = () => {};

// Fallback stub. iOS implementation lives in `lib/watch-connectivity.ios.ts`.
let latestWatchContext: Record<string, any> = {};

export const watchEvents = {
  addListener: (_event: string, _cb: (message: any) => void) => noop,
  on: (_event: string, _cb: (message: any) => void) => noop,
};

export const sendMessage = (_message: any) => {};

export const updateApplicationContext = (context: any) => {
  latestWatchContext = context ?? {};
};

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

export const getReachability = () => Promise.resolve(false);
export const getIsPaired = () => Promise.resolve(false);
export const getIsWatchAppInstalled = () => Promise.resolve(false);
