import {
  uploadWorkoutVideo,
  getSignedVideoUrl,
  listVideos,
} from '../../../lib/services/video-service';

const mockUploadAsync = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockGetThumbnailAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  uploadAsync: (...args: any[]) => mockUploadAsync(...args),
  getInfoAsync: (...args: any[]) => mockGetInfoAsync(...args),
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (...args: any[]) => mockGetThumbnailAsync(...args),
}));

// Setup Supabase mock inline to avoid hoisting issues
const mockSupabaseAuth = {
  getUser: jest.fn(),
  getSession: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: mockSupabaseAuth,
    storage: {
      from: jest.fn(() => ({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://test.com/video.mp4' } }),
        remove: jest.fn().mockResolvedValue({ error: null }),
      })),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      single: jest.fn().mockResolvedValue({ data: { id: 'test-video-id' } }),
    })),
  },
}));

describe('video-service env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
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
  });

  it('fails fast with clear error when SUPABASE_URL is missing', async () => {
    delete (process.env as any).EXPO_PUBLIC_SUPABASE_URL;

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
    delete (process.env as any).EXPO_PUBLIC_SUPABASE_ANON_KEY;

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
  beforeEach(() => {
    jest.clearAllMocks();
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
});
