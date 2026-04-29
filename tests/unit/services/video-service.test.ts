import Constants from 'expo-constants';
import { uploadWorkoutVideo } from '../../../lib/services/video-service';
import { supabase } from '@/lib/supabase';

const mockUploadAsync = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockGetThumbnailAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: any[]) => mockUploadAsync(...args),
  getInfoAsync: (...args: any[]) => mockGetInfoAsync(...args),
  FileSystemUploadType: {
    BINARY_CONTENT: 'binary-content',
  },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (...args: any[]) => mockGetThumbnailAsync(...args),
}));

jest.mock('@/lib/supabase', () => {
  const auth = {
    getUser: jest.fn(),
    getSession: jest.fn(),
  };
  return {
    supabase: {
      auth,
      storage: {
        from: jest.fn(),
      },
      from: jest.fn(),
    },
  };
});

const mockSupabase = supabase as any;
const mockSupabaseAuth = mockSupabase.auth as {
  getUser: jest.Mock;
  getSession: jest.Mock;
};

const getExpoExtras = () => {
  const constantsAny = Constants as any;
  return [constantsAny.expoConfig?.extra, constantsAny.default?.expoConfig?.extra].filter(Boolean);
};

const setSupabaseConfig = (url: string | undefined, anonKey: string | undefined) => {
  getExpoExtras().forEach((extra) => {
    extra.supabaseUrl = url;
    extra.supabaseAnonKey = anonKey;
  });
};

const clearSupabaseConfigKey = (key: 'supabaseUrl' | 'supabaseAnonKey') => {
  getExpoExtras().forEach((extra) => {
    delete extra[key];
  });
};

const configureSupabaseMocks = () => {
  mockSupabase.storage.from.mockImplementation(() => ({
    createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://test.com/video.mp4' }, error: null }),
    remove: jest.fn().mockResolvedValue({ error: null }),
  }));

  mockSupabase.from.mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    single: jest.fn().mockResolvedValue({
      data: {
        id: 'test-video-id',
        user_id: 'test-user-id',
        duration_seconds: 30,
        exercise: 'Push-ups',
      },
      error: null,
    }),
  }));
};

describe('video-service env validation', () => {
  const originalEnv = process.env;
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    setSupabaseConfig(originalExtra.supabaseUrl, originalExtra.supabaseAnonKey);
  });

  it('fails fast with clear error when SUPABASE_URL is missing', async () => {
    clearSupabaseConfigKey('supabaseUrl');

    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 1024,
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
      })
    ).rejects.toThrow('Missing EXPO_PUBLIC_SUPABASE_URL');
  });

  it('fails fast with clear error when SUPABASE_ANON_KEY is missing', async () => {
    clearSupabaseConfigKey('supabaseAnonKey');

    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 1024,
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
      })
    ).rejects.toThrow('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('rejects oversized files with user-friendly message', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 300 * 1024 * 1024, // 300MB, over 250MB default limit
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
      })
    ).rejects.toThrow('File is too large');
  });

  it('rejects non-existent files with clear error', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: false,
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://nonexistent.mp4',
      })
    ).rejects.toThrow('File does not exist');
  });

  it('handles upload HTTP errors gracefully', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 1024,
    });
    mockUploadAsync.mockResolvedValue({
      status: 500,
      body: 'Internal Server Error',
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
      })
    ).rejects.toThrow('Upload failed (500)');
  });

  it('handles network errors during upload', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 1024,
    });
    mockUploadAsync.mockRejectedValue(new Error('Network request failed'));

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
      })
    ).rejects.toThrow();
  });
});

describe('video-service success paths', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 1024,
    });
    mockGetThumbnailAsync.mockResolvedValue({
      uri: 'file://thumbnail.jpg',
    });
    mockUploadAsync.mockResolvedValue({
      status: 200,
      body: '{}',
    });
  });

  it('uploads video successfully with metadata', async () => {
    const result = await uploadWorkoutVideo({
      fileUri: 'file://test.mp4',
      durationSeconds: 30,
      exercise: 'Push-ups',
    });

    expect(result).toMatchObject({
      user_id: 'test-user-id',
      duration_seconds: 30,
      exercise: 'Push-ups',
    });
  });

  it('marks auto analysis uploads as analysis_only', async () => {
    let insertedPayload: Record<string, unknown> | null = null;
    mockSupabase.from.mockImplementation(() => {
      const chain: Record<string, any> = {
        select: jest.fn(() => chain),
        single: jest.fn().mockResolvedValue({
          data: {
            id: 'analysis-video-id',
            user_id: 'test-user-id',
            duration_seconds: null,
            exercise: 'Pull-up',
          },
          error: null,
        }),
      };
      chain.insert = jest.fn((payload) => {
        insertedPayload = payload;
        return chain;
      });
      return chain;
    });

    await uploadWorkoutVideo({
      fileUri: 'file://analysis.mp4',
      exercise: 'Pull-up',
      analysisOnly: true,
    });

    expect((insertedPayload as any)?.analysis_only).toBe(true);
  });

  it('uses .mov content type for .mov files', async () => {
    const uploadedContentTypes: string[] = [];
    mockUploadAsync.mockImplementation((_url: string, _uri: string, opts: any) => {
      uploadedContentTypes.push(opts?.headers?.['Content-Type']);
      return Promise.resolve({ status: 200, body: '{}' });
    });

    await uploadWorkoutVideo({ fileUri: 'file://test.mov' });

    // First upload call is the video itself
    expect(uploadedContentTypes[0]).toBe('video/quicktime');
  });

  it('uses video/mp4 content type for .mp4 files', async () => {
    const uploadedContentTypes: string[] = [];
    mockUploadAsync.mockImplementation((_url: string, _uri: string, opts: any) => {
      uploadedContentTypes.push(opts?.headers?.['Content-Type']);
      return Promise.resolve({ status: 200, body: '{}' });
    });

    await uploadWorkoutVideo({ fileUri: 'file://test.mp4' });

    expect(uploadedContentTypes[0]).toBe('video/mp4');
  });

  it('skips thumbnail for files exceeding maxThumbnailBytes', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 100 * 1024 * 1024, // 100MB
    });

    await uploadWorkoutVideo({
      fileUri: 'file://large.mp4',
      maxThumbnailBytes: 50 * 1024 * 1024, // 50MB threshold
    });

    // Thumbnail generation should NOT be called for oversized files
    expect(mockGetThumbnailAsync).not.toHaveBeenCalled();
  });

  it('continues upload when thumbnail generation fails', async () => {
    mockGetThumbnailAsync.mockRejectedValue(new Error('FFmpeg crash'));

    const result = await uploadWorkoutVideo({
      fileUri: 'file://test.mp4',
    });

    // Upload should still succeed
    expect(result).toMatchObject({ user_id: 'test-user-id' });
  });
});

// =============================================================================
// listVideos / getVideoById
// =============================================================================

describe('video-service query operations', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });
  });

  it('getVideoById throws when video is not found', async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const { getVideoById } = require('../../../lib/services/video-service');
    await expect(getVideoById('nonexistent-id')).rejects.toThrow('Video not found');
  });

  it('listVideos clamps limit between 1 and 50', async () => {
    let capturedLimit: number | undefined;
    const chainObj: Record<string, any> = {};
    chainObj.select = jest.fn(() => chainObj);
    chainObj.eq = jest.fn(() => chainObj);
    chainObj.in = jest.fn(() => chainObj);
    chainObj.order = jest.fn(() => chainObj);
    chainObj.limit = jest.fn((n: number) => {
      capturedLimit = n;
      // Still return a chainable object that also resolves when awaited
      return { ...chainObj, then: (resolve: any) => resolve({ data: [], error: null }) };
    });
    chainObj.then = (resolve: any) => resolve({ data: [], error: null });
    mockSupabase.from.mockReturnValue(chainObj);

    const { listVideos } = require('../../../lib/services/video-service');
    await listVideos(999);

    expect(capturedLimit).toBe(50);
  });
});

// =============================================================================
// Comment operations
// =============================================================================

describe('video-service comments', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
  });

  it('addVideoComment rejects empty comments', async () => {
    const { addVideoComment } = require('../../../lib/services/video-service');
    await expect(addVideoComment('vid-1', '   ')).rejects.toThrow('Comment cannot be empty');
  });

  it('addVideoComment trims and persists the comment', async () => {
    let insertedComment: string | undefined;
    mockSupabase.from.mockImplementation(() => ({
      insert: jest.fn((payload: any) => {
        insertedComment = payload.comment;
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: 'c1', video_id: 'vid-1', user_id: 'test-user-id', comment: payload.comment, created_at: '2024-01-01' },
            error: null,
          }),
        };
      }),
    }));

    const { addVideoComment } = require('../../../lib/services/video-service');
    const result = await addVideoComment('vid-1', '  Nice form!  ');

    expect(insertedComment).toBe('Nice form!');
    expect(result).toMatchObject({ comment: 'Nice form!' });
  });

  it('fetchVideoComments returns ordered comments', async () => {
    const comments = [
      { id: 'c1', video_id: 'v1', user_id: 'u1', comment: 'First', created_at: '2024-01-01' },
      { id: 'c2', video_id: 'v1', user_id: 'u2', comment: 'Second', created_at: '2024-01-02' },
    ];
    mockSupabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: comments, error: null }),
    }));

    const { fetchVideoComments } = require('../../../lib/services/video-service');
    const result = await fetchVideoComments('v1');

    expect(result).toHaveLength(2);
    expect(result[0].comment).toBe('First');
  });

  it('subscribeToVideoComments returns an unsubscribe function', () => {
    const mockChannel = {
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    };
    mockSupabase.channel = jest.fn().mockReturnValue(mockChannel);
    mockSupabase.removeChannel = jest.fn();

    const { subscribeToVideoComments } = require('../../../lib/services/video-service');
    const unsubscribe = subscribeToVideoComments('vid-1', jest.fn());

    expect(typeof unsubscribe).toBe('function');
    expect(mockSupabase.channel).toHaveBeenCalledWith('video-comments-vid-1');

    unsubscribe();
    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
  });
});

// =============================================================================
// Like toggle
// =============================================================================

describe('video-service likes', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
  });

  it('toggleVideoLike likes a video when not yet liked', async () => {
    let likeInserted = false;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'video_likes') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn(() => {
            likeInserted = true;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {};
    });

    const { toggleVideoLike } = require('../../../lib/services/video-service');
    const result = await toggleVideoLike('vid-1');

    expect(result).toEqual({ liked: true });
    expect(likeInserted).toBe(true);
  });

  it('toggleVideoLike unlikes a video when already liked', async () => {
    let likeDeleted = false;
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'video_likes') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { video_id: 'vid-1' },
            error: null,
          }),
          delete: jest.fn(() => {
            likeDeleted = true;
            return {
              eq: jest.fn().mockReturnThis(),
              then: (resolve: any) => resolve({ error: null }),
            };
          }),
        };
      }
      return {};
    });

    const { toggleVideoLike } = require('../../../lib/services/video-service');
    const result = await toggleVideoLike('vid-1');

    expect(result).toEqual({ liked: false });
    expect(likeDeleted).toBe(true);
  });
});

// =============================================================================
// Delete ownership check
// =============================================================================

describe('video-service delete', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
  });

  it('deleteVideo rejects when video does not exist', async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const { deleteVideo } = require('../../../lib/services/video-service');
    await expect(deleteVideo('nonexistent')).rejects.toThrow('Video not found');
  });

  it('deleteVideo rejects when user does not own the video', async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'vid-1', user_id: 'other-user', path: 'other/vid.mp4', thumbnail_path: null },
        error: null,
      }),
    }));

    const { deleteVideo } = require('../../../lib/services/video-service');
    await expect(deleteVideo('vid-1')).rejects.toThrow('You can only delete your own videos');
  });

  it('deleteVideo succeeds and cleans up storage for owned video', async () => {
    const removeMock = jest.fn().mockResolvedValue({ error: null });
    let deleteCallIndex = 0;

    mockSupabase.from.mockImplementation(() => {
      deleteCallIndex++;
      if (deleteCallIndex === 1) {
        // First call: select video
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: {
              id: 'vid-1',
              user_id: 'test-user-id',
              path: 'test-user-id/vid-1.mp4',
              thumbnail_path: 'test-user-id/vid-1.jpg',
            },
            error: null,
          }),
        };
      }
      // Second call: delete video record
      return {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
    });
    mockSupabase.storage.from.mockReturnValue({ remove: removeMock });

    const { deleteVideo } = require('../../../lib/services/video-service');
    const result = await deleteVideo('vid-1');

    expect(result).toBe(true);
    // Should clean up video + thumbnail from both buckets
    expect(removeMock).toHaveBeenCalled();
  });
});

// =============================================================================
// recordVideoView
// =============================================================================

describe('video-service views', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
    configureSupabaseMocks();
  });

  it('recordVideoView inserts a view with user_id when signed in', async () => {
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
    let insertedPayload: any = null;
    mockSupabase.from.mockImplementation(() => ({
      insert: jest.fn((payload: any) => {
        insertedPayload = payload;
        return Promise.resolve({ error: null });
      }),
    }));

    const { recordVideoView } = require('../../../lib/services/video-service');
    const result = await recordVideoView('vid-1');

    expect(result).toBe(true);
    expect(insertedPayload).toMatchObject({ video_id: 'vid-1', user_id: 'test-user-id' });
  });

  it('recordVideoView inserts a view without user_id when not signed in', async () => {
    mockSupabaseAuth.getUser.mockRejectedValue(new Error('Not signed in'));
    let insertedPayload: any = null;
    mockSupabase.from.mockImplementation(() => ({
      insert: jest.fn((payload: any) => {
        insertedPayload = payload;
        return Promise.resolve({ error: null });
      }),
    }));

    const { recordVideoView } = require('../../../lib/services/video-service');
    const result = await recordVideoView('vid-1');

    expect(result).toBe(true);
    expect(insertedPayload).toEqual({ video_id: 'vid-1' });
  });
});

// =============================================================================
// getSignedVideoUrl / getSignedThumbnailUrl
// =============================================================================

describe('video-service signed URLs', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key'
    );
  });

  it('getSignedVideoUrl returns the signed URL', async () => {
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.test/signed-video-url' },
        error: null,
      }),
    });

    const { getSignedVideoUrl } = require('../../../lib/services/video-service');
    const url = await getSignedVideoUrl('user/video.mp4');

    expect(url).toBe('https://storage.test/signed-video-url');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('videos');
  });

  it('getSignedVideoUrl throws on storage error', async () => {
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Bucket not found'),
      }),
    });

    const { getSignedVideoUrl } = require('../../../lib/services/video-service');
    await expect(getSignedVideoUrl('user/video.mp4')).rejects.toThrow('Bucket not found');
  });

  it('getSignedThumbnailUrl returns null for null path', async () => {
    const { getSignedThumbnailUrl } = require('../../../lib/services/video-service');
    const url = await getSignedThumbnailUrl(null);

    expect(url).toBeNull();
  });

  it('getSignedThumbnailUrl returns the signed URL for valid path', async () => {
    mockSupabase.storage.from.mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: 'https://storage.test/signed-thumb-url' },
        error: null,
      }),
    });

    const { getSignedThumbnailUrl } = require('../../../lib/services/video-service');
    const url = await getSignedThumbnailUrl('user/thumb.jpg');

    expect(url).toBe('https://storage.test/signed-thumb-url');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('video-thumbnails');
  });
});

// =============================================================================
// Upload progress, mid-upload network error, thumbnail timeout (Issue #545)
// =============================================================================
//
// Targets the four gaps called out by #545:
//   1. Progress-callback propagation (skipped — production API does not
//      expose progress yet).
//   2. Mid-upload network error → cleanup + error surfacing.
//   3. Thumbnail-generation timeout → main upload still completes.
//   4. Pre-upload file-size validation → rejected before any network I/O.

describe('video-service upload progress & network failure recovery', () => {
  const firstExtra = getExpoExtras()[0] ?? {};
  const originalExtra = { ...firstExtra };

  beforeEach(() => {
    jest.clearAllMocks();
    setSupabaseConfig(
      originalExtra.supabaseUrl ?? 'https://test.supabase.co',
      originalExtra.supabaseAnonKey ?? 'test-anon-key',
    );
    configureSupabaseMocks();
    mockSupabaseAuth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    });
    mockSupabaseAuth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
      error: null,
    });
  });

  // ---- 1. Progress callback propagation (deferred) -----------------------
  //
  // Production `FileSystem.uploadAsync` call site at video-service.ts:161
  // does NOT pass an `onProgress` callback nor expose one to consumers. The
  // #545 acceptance criterion says: "If the service doesn't currently expose
  // progress, add the test to drive that requirement but keep it test.skip
  // with a comment pointing to future work." The production change is
  // tracked separately — this test will flip to passing once
  // `uploadWorkoutVideo` accepts an `onProgress` option and threads it into
  // FileSystem.uploadAsync.
  test.skip('propagates onProgress events from FileSystem.uploadAsync to the caller (BLOCKED on production API extension — see #545)', async () => {
    // Intended shape (once production exposes it):
    //
    //   const progressEvents: number[] = [];
    //   mockUploadAsync.mockImplementation(async (_url, _uri, opts) => {
    //     opts.onProgress?.({ totalByteSent: 1024, totalBytesExpectedToSend: 2048 });
    //     opts.onProgress?.({ totalByteSent: 2048, totalBytesExpectedToSend: 2048 });
    //     return { status: 200, body: '{}' };
    //   });
    //   await uploadWorkoutVideo({
    //     fileUri: 'file://test.mp4',
    //     onProgress: (fraction) => progressEvents.push(fraction),
    //   });
    //   expect(progressEvents).toEqual([0.5, 1]);
  });

  // ---- 2. Mid-upload network error ---------------------------------------

  it('surfaces a typed error when the network drops mid-upload and does not persist a partial video row', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });

    // FileSystem.uploadAsync rejects partway through (mobile-network blip).
    mockUploadAsync.mockRejectedValue(new Error('Network request failed'));

    let insertCalls = 0;
    mockSupabase.from.mockImplementation(() => ({
      insert: jest.fn(() => {
        insertCalls++;
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }));

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
        exercise: 'Squat',
      }),
    ).rejects.toThrow(/Network request failed/);

    // Critical: no DB row written for a failed upload — the failure must
    // propagate BEFORE the insert side-effect runs.
    expect(insertCalls).toBe(0);
  });

  it('surfaces HTTP-error status codes (non-2xx) as explicit Upload failed errors', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 2048 });
    mockUploadAsync.mockResolvedValue({
      status: 413,
      body: 'Request entity too large',
    });

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://big.mp4',
      }),
    ).rejects.toThrow('Upload failed (413)');
  });

  it('mid-upload rejection does not leak a thumbnail (thumbnail generator never runs if main upload fails first)', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
    mockUploadAsync.mockRejectedValueOnce(new Error('Connection reset'));
    mockGetThumbnailAsync.mockResolvedValue({ uri: 'file://thumb.jpg' });

    await expect(
      uploadWorkoutVideo({ fileUri: 'file://test.mp4' }),
    ).rejects.toThrow(/Connection reset/);

    // Thumbnail generation is gated on the video upload succeeding —
    // VideoThumbnails.getThumbnailAsync must NOT have been called.
    expect(mockGetThumbnailAsync).not.toHaveBeenCalled();
  });

  // ---- 3. Thumbnail-generation timeout → main upload completes -----------

  it('thumbnail-generation timeout does not prevent the main upload from succeeding', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
    mockUploadAsync.mockResolvedValue({ status: 200, body: '{}' });

    // Thumbnail generator hangs long enough to mimic a timeout. Real impl
    // catches any error (see video-service.ts:381-384 `warnWithTs`). We use
    // a rejected timeout to emulate a would-be AbortError/timeout.
    mockGetThumbnailAsync.mockRejectedValue(new Error('Thumbnail timed out'));

    const result = await uploadWorkoutVideo({
      fileUri: 'file://test.mp4',
      exercise: 'Deadlift',
    });

    // Main upload should still have persisted a video row, just without a
    // thumbnail path.
    expect(result).toMatchObject({ user_id: 'test-user-id' });
    // The insert fallback used in `configureSupabaseMocks` returns a
    // default video row; key assertion is that the upload itself did
    // not throw and the insert ran.
  });

  it('large file skips thumbnail entirely (per maxThumbnailBytes guard) — upload still completes', async () => {
    // Verifies the production branch at video-service.ts:385-387 which
    // skips thumbnail generation for big files to avoid memory pressure.
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 90 * 1024 * 1024, // 90MB
    });
    mockUploadAsync.mockResolvedValue({ status: 200, body: '{}' });

    const result = await uploadWorkoutVideo({
      fileUri: 'file://huge.mp4',
      maxThumbnailBytes: 80 * 1024 * 1024, // 80MB threshold — skip
    });

    expect(result).toMatchObject({ user_id: 'test-user-id' });
    expect(mockGetThumbnailAsync).not.toHaveBeenCalled();
  });

  // ---- 4. Pre-upload file-size validation --------------------------------

  it('rejects oversized files BEFORE any network I/O (no getSession, no uploadAsync call)', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: 500 * 1024 * 1024, // 500MB — way over the 250MB default cap
    });

    await expect(
      uploadWorkoutVideo({ fileUri: 'file://too-big.mp4' }),
    ).rejects.toThrow(/File is too large/);

    // No network I/O happened — uploadAsync was never invoked.
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('rejects zero-byte / missing files with a clear error before any network I/O', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: false });

    await expect(
      uploadWorkoutVideo({ fileUri: 'file://missing.mp4' }),
    ).rejects.toThrow(/File does not exist/);

    expect(mockUploadAsync).not.toHaveBeenCalled();
    expect(mockGetThumbnailAsync).not.toHaveBeenCalled();
  });

  it('rejects oversized metrics payloads as validation errors BEFORE any I/O', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });

    // Build a metrics payload that exceeds the 10 KiB cap at
    // video-service.ts:332-336.
    const bigMetrics: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      bigMetrics[`k${i}`] = 'x'.repeat(20);
    }

    // createError() returns a typed AppError object (not a thrown Error
    // instance) — use rejects.toMatchObject against the AppError shape
    // so we assert the typed domain + code and not just a message regex.
    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
        metrics: bigMetrics,
      }),
    ).rejects.toMatchObject({
      domain: 'validation',
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Metrics payload exceeds maximum size/),
    });

    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('rejects oversized exercise-name strings as validation errors BEFORE any I/O', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });

    const tooLong = 'x'.repeat(300); // 300 chars > 255 cap

    await expect(
      uploadWorkoutVideo({
        fileUri: 'file://test.mp4',
        exercise: tooLong,
      }),
    ).rejects.toMatchObject({
      domain: 'validation',
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/Exercise name exceeds maximum length/),
    });

    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});
