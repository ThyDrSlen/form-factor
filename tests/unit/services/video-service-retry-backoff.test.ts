/**
 * Tests for lib/services/video-service.ts retry + backoff behavior.
 *
 * The module wraps signed-URL fetches in a private `withRetry(fn, maxRetries=2,
 * delayMs=500)` helper with linear backoff (delayMs * (attempt + 1)). We drive
 * the retry surface through `getVideoById` which funnels into `enrichVideoRows`
 * → `safeGetSignedVideoUrl` / `safeGetSignedThumbnailUrl`.
 *
 * Assertions:
 *  - Network disconnect mid-fetch → retry until success (no duplicate rows).
 *  - Persistent failure after all retries → caller gets `undefined` (video)
 *    or `null` (thumbnail), never a thrown exception that would reject the
 *    list-videos promise and orphan the UI.
 *  - Success on the first try incurs exactly ONE call (no spurious retry).
 *  - Backoff math is linear + monotonic (delay increases with each attempt).
 *
 * Closes #545 (T5 — video-service retry/backoff).
 */

const mockCreateSignedUrl = jest.fn();
const mockFrom = jest.fn();
const mockMaybeSingle = jest.fn();
let mockSetTimeout: jest.SpyInstance;
const capturedDelays: number[] = [];

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1000 }),
  FileSystemUploadType: { BINARY_CONTENT: 'binary-content' },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn().mockResolvedValue({ uri: 'file:///thumb.jpg' }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'tok' } },
        error: null,
      }),
    },
    storage: {
      from: jest.fn(() => ({
        createSignedUrl: (...args: any[]) => mockCreateSignedUrl(...args),
        remove: jest.fn().mockResolvedValue({ error: null }),
      })),
    },
    from: (...args: any[]) => mockFrom(...args),
  },
}));

jest.mock('@/lib/auth-utils', () => ({
  ensureUser: jest.fn().mockResolvedValue({ id: 'u-1' }),
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((_d, _c, m) => new Error(m)),
}));

import { getVideoById } from '@/lib/services/video-service';

function mockVideoRow() {
  return {
    id: 'vid-1',
    user_id: 'u-1',
    path: 'u-1/vid-1.mp4',
    thumbnail_path: 'u-1/vid-1.jpg',
    duration_seconds: 30,
    exercise: 'pullup',
    metrics: null,
    analysis_only: false,
    created_at: '2025-01-01T00:00:00Z',
    video_likes: [{ count: 0 }],
    video_comments: [{ count: 0 }],
  };
}

function configureVideosQuery() {
  mockMaybeSingle.mockResolvedValue({ data: mockVideoRow(), error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'videos') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        maybeSingle: mockMaybeSingle,
      };
    }
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    // Fallback
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe('video-service: withRetry + backoff across network flip (#545)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedDelays.length = 0;
    configureVideosQuery();

    // Intercept setTimeout so we can capture retry delays without actually
    // waiting. Call through to setImmediate so promises still resolve.
    mockSetTimeout = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: any, delay?: number) => {
        if (typeof delay === 'number') capturedDelays.push(delay);
        // Run immediately to keep tests fast.
        Promise.resolve().then(cb);
        return 0 as any;
      });
  });

  afterEach(() => {
    mockSetTimeout.mockRestore();
  });

  test('success on first try: createSignedUrl called exactly once per URL (no retries)', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/video.mp4' },
      error: null,
    });

    const result = await getVideoById('vid-1');

    // Two URL signings total: video + thumbnail, each called exactly once.
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(2);
    expect(result.signedUrl).toBe('https://signed.example/video.mp4');
    // No backoff delays captured — we never retried.
    expect(capturedDelays).toEqual([]);
  });

  test('transient failure then success: retries until success, no duplicate video rows', async () => {
    let callCount = 0;
    mockCreateSignedUrl.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 2) {
        // First two attempts fail — simulates network disconnect.
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve({ data: { signedUrl: 'https://ok.example/v.mp4' }, error: null });
    });

    const result = await getVideoById('vid-1');

    // Video + thumbnail each try up to 3 times. The 3rd attempt succeeds for
    // both. Total calls depend on interleaving but video must eventually
    // return the signed URL without throwing.
    expect(result.signedUrl).toBe('https://ok.example/v.mp4');
    // Maybe-single was called exactly once — no duplicate video row fetched.
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });

  test('persistent failure: withRetry surfaces undefined (video) and null (thumbnail), never throws', async () => {
    mockCreateSignedUrl.mockRejectedValue(new Error('offline'));

    // Must not throw — caller can still render the video row even without URLs.
    const result = await getVideoById('vid-1');
    expect(result.signedUrl).toBeUndefined();
    expect(result.thumbnailUrl).toBeNull();

    // Linear backoff (delayMs * (attempt + 1)) with delayMs=500 + maxRetries=2
    // → delays captured should be 500 and 1000 (and possibly the same pair
    // for the parallel thumbnail fetch). Assert monotonically increasing.
    // At minimum we expect the first two delays to be 500 and 1000 for one
    // of the concurrent chains.
    const uniqueDelays = Array.from(new Set(capturedDelays)).sort((a, b) => a - b);
    expect(uniqueDelays).toContain(500);
    expect(uniqueDelays).toContain(1000);
    // 1500 would be delay for a 4th attempt — max retries is 2, so we should
    // never see this value (2 retries means attempt indices 0,1,2 → delays
    // only between attempts = 500 and 1000, never 1500).
    expect(uniqueDelays).not.toContain(1500);
  });

  test('linear backoff: second retry delay is larger than first', async () => {
    mockCreateSignedUrl.mockRejectedValue(new Error('offline'));

    await getVideoById('vid-1');

    // Filter to one chain's delays (they may interleave with the thumbnail
    // chain). Sort unique values and check linear growth.
    const uniqueDelays = Array.from(new Set(capturedDelays)).sort((a, b) => a - b);
    expect(uniqueDelays.length).toBeGreaterThanOrEqual(2);
    expect(uniqueDelays[1]).toBeGreaterThan(uniqueDelays[0]);
    // Ratio == 2 confirms linear (delay * (attempt+1)): 500, 1000.
    expect(uniqueDelays[1] / uniqueDelays[0]).toBeCloseTo(2, 5);
  });

  test('network flips back to reachable on last retry: URL is returned without duplicate upload calls', async () => {
    // Only the VERY LAST attempt (attempt 2, i.e. 3rd call) succeeds. This
    // simulates the "disconnect → reconnect at the edge of backoff" pattern.
    let attempts = 0;
    mockCreateSignedUrl.mockImplementation(() => {
      attempts += 1;
      if (attempts >= 3) {
        return Promise.resolve({ data: { signedUrl: 'https://edge.example/v.mp4' }, error: null });
      }
      return Promise.reject(new Error('still offline'));
    });

    const result = await getVideoById('vid-1');
    expect(result.signedUrl).toBe('https://edge.example/v.mp4');
    // Only one row lookup — no duplicate/orphaned video row fetches.
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });
});
