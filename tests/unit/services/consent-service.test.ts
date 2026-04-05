const mockEnsureUserId = jest.fn();
const mockSingle = jest.fn();
const mockUpsert = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn((table: string) => {
  if (table === 'user_telemetry_consent') {
    return {
      select: mockSelect,
      upsert: mockUpsert,
    };
  }

  return {
    select: mockSelect,
    upsert: mockUpsert,
  };
});

jest.mock('@/lib/auth-utils', () => ({
  ensureUserId: (...args: unknown[]) => mockEnsureUserId(...args),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

let consentService: typeof import('@/lib/services/consent-service');

describe('consent-service', () => {
  beforeAll(async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    consentService = await import('@/lib/services/consent-service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    consentService.invalidateConsentCache();
    mockEnsureUserId.mockResolvedValue('user-123');
    mockSingle.mockResolvedValue({
      data: {
        allow_anonymous_telemetry: false,
        allow_video_upload: true,
        allow_trainer_labeling: true,
        allow_extended_retention: false,
      },
      error: null,
    });
    mockUpsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached consent within the TTL and refetches after expiry', async () => {
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_200)
      .mockReturnValueOnce(301_500)
      .mockReturnValueOnce(301_600);

    const first = await consentService.getConsent();
    const second = await consentService.getConsent();
    const third = await consentService.getConsent();

    expect(first).toEqual({
      allowAnonymousTelemetry: false,
      allowVideoUpload: true,
      allowTrainerLabeling: true,
      allowExtendedRetention: false,
    });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(mockSingle).toHaveBeenCalledTimes(2);
  });

  it('returns default consent when no row exists', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    await expect(consentService.getConsent()).resolves.toEqual({
      allowAnonymousTelemetry: true,
      allowVideoUpload: false,
      allowTrainerLabeling: false,
      allowExtendedRetention: false,
    });
  });

  it('invalidates the cache when consent is updated', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    await consentService.getConsent();
    await consentService.updateConsent({ allowVideoUpload: false, allowExtendedRetention: true });
    await consentService.getConsent();

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        allow_video_upload: false,
        allow_extended_retention: true,
        updated_at: expect.any(String),
      }),
      { onConflict: 'user_id' }
    );
    expect(mockSingle).toHaveBeenCalledTimes(2);
  });

  it('uses cached consent for synchronous permission checks and falls back to defaults without cache', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(20_000);
    expect(consentService.shouldLogFramesSync()).toBe(true);
    expect(consentService.shouldUploadVideoSync()).toBe(false);

    await consentService.getConsent();

    expect(consentService.shouldLogFramesSync()).toBe(false);
    expect(consentService.shouldUploadVideoSync()).toBe(true);
  });
});
