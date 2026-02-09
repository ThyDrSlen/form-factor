import {
  bumpShadowProviderCount,
  createShadowProviderCounts,
  selectShadowProvider,
  summarizeShadowProvider,
} from '@/lib/pose/shadow-provider';

test('selectShadowProvider falls back to proxy when preferred is proxy', () => {
  const provider = selectShadowProvider({
    preferredProvider: 'mediapipe_proxy',
    primaryTimestamp: 10,
    mediaPipeTimestamp: 10,
  });

  expect(provider).toBe('mediapipe_proxy');
});

test('selectShadowProvider uses mediapipe when timestamps are fresh', () => {
  const provider = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 22.0,
    mediaPipeTimestamp: 21.8,
    maxTimestampSkewSec: 0.4,
  });

  expect(provider).toBe('mediapipe');
});

test('selectShadowProvider falls back when mediapipe data is stale', () => {
  const provider = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 30.0,
    mediaPipeTimestamp: 29.0,
    maxTimestampSkewSec: 0.4,
  });

  expect(provider).toBe('mediapipe_proxy');
});

test('summarizeShadowProvider resolves dominant provider from counts', () => {
  const counts = createShadowProviderCounts();
  bumpShadowProviderCount(counts, 'mediapipe_proxy');
  bumpShadowProviderCount(counts, 'mediapipe_proxy');
  bumpShadowProviderCount(counts, 'mediapipe');

  expect(summarizeShadowProvider(counts, 'mediapipe')).toBe('mediapipe_proxy');
});
