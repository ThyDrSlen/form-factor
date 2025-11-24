import {
  watchEvents,
  sendMessage,
  updateApplicationContext as baseUpdateApplicationContext,
  getReachability,
  getIsPaired,
  getIsWatchAppInstalled,
} from 'react-native-watch-connectivity';

let latestWatchContext: Record<string, any> = {};

export function updateWatchContext(patch: Record<string, any>) {
  latestWatchContext = { ...latestWatchContext, ...patch };
  try {
    baseUpdateApplicationContext(latestWatchContext);
  } catch (err) {
    console.warn('[WatchConnectivity] Failed to update context', err);
  }
}

export function getLatestWatchContext() {
  return latestWatchContext;
}

export const updateApplicationContext = baseUpdateApplicationContext;

export {
  watchEvents,
  sendMessage,
  getReachability,
  getIsPaired,
  getIsWatchAppInstalled,
};
