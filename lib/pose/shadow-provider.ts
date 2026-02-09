import type { PoseProvider } from '@/lib/pose/types';

export type ShadowProvider = Extract<PoseProvider, 'mediapipe' | 'mediapipe_proxy'>;

export interface ShadowProviderCounts {
  mediapipe: number;
  mediapipe_proxy: number;
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
}): ShadowProvider {
  if (input.preferredProvider !== 'mediapipe') {
    return 'mediapipe_proxy';
  }

  if (typeof input.mediaPipeTimestamp !== 'number' || !Number.isFinite(input.mediaPipeTimestamp)) {
    return 'mediapipe_proxy';
  }

  const maxSkewSec = input.maxTimestampSkewSec ?? 0.4;
  const skew = Math.abs(input.primaryTimestamp - input.mediaPipeTimestamp);
  return skew <= maxSkewSec ? 'mediapipe' : 'mediapipe_proxy';
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
