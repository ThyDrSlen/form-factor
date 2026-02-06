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
});
