import type { PoseProvider } from '@/lib/pose/types';

export type ShadowProvider = Extract<PoseProvider, 'mediapipe' | 'mediapipe_proxy'>;

export interface ShadowProviderCounts {
  mediapipe: number;
  mediapipe_proxy: number;
}

const DEFAULT_MAX_TIMESTAMP_SKEW_SEC = 0.4;
const ACTIVE_REP_STICKY_WINDOW_SEC = 0.15;

let activeRepStickyProvider: ShadowProvider | null = null;
let activeRepStickySincePrimaryTs: number | null = null;

export function resetShadowProviderStickySelectionState(): void {
  activeRepStickyProvider = null;
  activeRepStickySincePrimaryTs = null;
}

export function createShadowProviderCounts(): ShadowProviderCounts {
  return {
    mediapipe: 0,
    mediapipe_proxy: 0,
  };
}

export function selectShadowProvider(input: {
  preferredProvider: ShadowProvider;
  primaryTimestamp: number;
  mediaPipeTimestamp?: number | null;
  maxTimestampSkewSec?: number;
  isInActiveRep?: boolean;
}): ShadowProvider {
  const isInActiveRep = input.isInActiveRep === true;
  if (!isInActiveRep) {
    resetShadowProviderStickySelectionState();
  }

  let requiresProxy = input.preferredProvider !== 'mediapipe';

  if (!requiresProxy) {
    if (typeof input.mediaPipeTimestamp !== 'number' || !Number.isFinite(input.mediaPipeTimestamp)) {
      requiresProxy = true;
    } else {
      const maxSkewSec = input.maxTimestampSkewSec ?? DEFAULT_MAX_TIMESTAMP_SKEW_SEC;
      const skew = Math.abs(input.primaryTimestamp - input.mediaPipeTimestamp);
      requiresProxy = skew > maxSkewSec;
    }
  }

  const candidate: ShadowProvider = requiresProxy ? 'mediapipe_proxy' : 'mediapipe';

  if (!isInActiveRep) {
    return candidate;
  }

  if (activeRepStickyProvider === null || activeRepStickySincePrimaryTs === null) {
    activeRepStickyProvider = candidate;
    activeRepStickySincePrimaryTs = input.primaryTimestamp;
    return candidate;
  }

  if (requiresProxy) {
    activeRepStickyProvider = 'mediapipe_proxy';
    activeRepStickySincePrimaryTs = input.primaryTimestamp;
    return 'mediapipe_proxy';
  }

  if (activeRepStickyProvider === 'mediapipe') {
    return 'mediapipe';
  }

  const heldForSec = input.primaryTimestamp - activeRepStickySincePrimaryTs;
  if (heldForSec < ACTIVE_REP_STICKY_WINDOW_SEC) {
    return 'mediapipe_proxy';
  }

  activeRepStickyProvider = 'mediapipe';
  activeRepStickySincePrimaryTs = input.primaryTimestamp;
  return 'mediapipe';
}

export function bumpShadowProviderCount(counts: ShadowProviderCounts, provider: ShadowProvider): void {
  counts[provider] = (counts[provider] ?? 0) + 1;
}

export function summarizeShadowProvider(
  counts: ShadowProviderCounts,
  fallback: ShadowProvider
): ShadowProvider {
  const mediaPipeFrames = counts.mediapipe ?? 0;
  const proxyFrames = counts.mediapipe_proxy ?? 0;

  if (mediaPipeFrames === 0 && proxyFrames === 0) {
    return fallback;
  }

  return mediaPipeFrames >= proxyFrames ? 'mediapipe' : 'mediapipe_proxy';
}
