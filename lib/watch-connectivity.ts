const noop = () => {};

// Watch connectivity disabled for MVP stability.
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
  latestWatchContext = { ...latestWatchContext, ...patch };
  updateApplicationContext(latestWatchContext);
}

export function getLatestWatchContext() {
  return latestWatchContext;
}

export const getReachability = () => Promise.resolve(false);
export const getIsPaired = () => Promise.resolve(false);
export const getIsWatchAppInstalled = () => Promise.resolve(false);
