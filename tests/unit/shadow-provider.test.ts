import {
  bumpShadowProviderCount,
  createShadowProviderCounts,
  resetShadowProviderStickySelectionState,
  selectShadowProvider,
  summarizeShadowProvider,
} from '@/lib/pose/shadow-provider';

beforeEach(() => {
  resetShadowProviderStickySelectionState();
});

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

test('selectShadowProvider jitter does not flip-flop during active rep', () => {
  const maxTimestampSkewSec = 0.4;

  const frames = [
    { primaryTimestamp: 100.0, skew: 0.39 },
    { primaryTimestamp: 100.05, skew: 0.41 },
    { primaryTimestamp: 100.1, skew: 0.39 },
    { primaryTimestamp: 100.15, skew: 0.41 },
    { primaryTimestamp: 100.2, skew: 0.39 },
    { primaryTimestamp: 100.25, skew: 0.41 },
  ];

  const selected = frames.map((frame) =>
    selectShadowProvider({
      preferredProvider: 'mediapipe',
      primaryTimestamp: frame.primaryTimestamp,
      mediaPipeTimestamp: frame.primaryTimestamp - frame.skew,
      maxTimestampSkewSec,
      isInActiveRep: true,
    })
  );

  expect(selected.slice(1)).toEqual([
    'mediapipe_proxy',
    'mediapipe_proxy',
    'mediapipe_proxy',
    'mediapipe_proxy',
    'mediapipe_proxy',
  ]);
});

test('selectShadowProvider falls back to proxy on stale timestamp even during active rep', () => {
  const warm = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 200.0,
    mediaPipeTimestamp: 199.8,
    maxTimestampSkewSec: 0.4,
    isInActiveRep: true,
  });

  expect(warm).toBe('mediapipe');

  const provider = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 200.01,
    mediaPipeTimestamp: 199.0,
    maxTimestampSkewSec: 0.4,
    isInActiveRep: true,
  });

  expect(provider).toBe('mediapipe_proxy');
});

test('selectShadowProvider holds proxy for minimum window during active rep', () => {
  const maxTimestampSkewSec = 0.4;

  const start = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 10.0,
    mediaPipeTimestamp: 9.8,
    maxTimestampSkewSec,
    isInActiveRep: true,
  });

  expect(start).toBe('mediapipe');

  const stale = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 10.05,
    mediaPipeTimestamp: 9.0,
    maxTimestampSkewSec,
    isInActiveRep: true,
  });

  expect(stale).toBe('mediapipe_proxy');

  const tooSoon = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 10.1,
    mediaPipeTimestamp: 9.9,
    maxTimestampSkewSec,
    isInActiveRep: true,
  });

  expect(tooSoon).toBe('mediapipe_proxy');

  const afterWindow = selectShadowProvider({
    preferredProvider: 'mediapipe',
    primaryTimestamp: 10.21,
    mediaPipeTimestamp: 10.01,
    maxTimestampSkewSec,
    isInActiveRep: true,
  });

  expect(afterWindow).toBe('mediapipe');
});

test('summarizeShadowProvider resolves dominant provider from counts', () => {
  const counts = createShadowProviderCounts();
  bumpShadowProviderCount(counts, 'mediapipe_proxy');
  bumpShadowProviderCount(counts, 'mediapipe_proxy');
  bumpShadowProviderCount(counts, 'mediapipe');

  expect(summarizeShadowProvider(counts, 'mediapipe')).toBe('mediapipe_proxy');
});
