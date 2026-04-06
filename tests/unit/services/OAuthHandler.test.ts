const mockCreateURL = jest.fn(() => 'formfactor://callback');
const mockParse = jest.fn();
const mockMaybeCompleteAuthSession = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

const mockSignInWithOAuth = jest.fn();
const mockSetSession = jest.fn();
const mockExchangeCodeForSession = jest.fn();

jest.mock('expo-linking', () => ({
  createURL: mockCreateURL,
  parse: mockParse,
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: (...args: unknown[]) => mockMaybeCompleteAuthSession(...args),
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(),
  digestStringAsync: jest.fn(),
  randomUUID: jest.fn(() => 'test-oauth-state-123'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

jest.mock('@supabase/supabase-js', () => ({}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

const mockSupabase = {
  auth: {
    signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    setSession: (...args: unknown[]) => mockSetSession(...args),
    exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
  },
};

jest.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: mockSupabase,
}));

let OAuthHandler: typeof import('@/lib/services/OAuthHandler')['OAuthHandler'];

describe('OAuthHandler', () => {
  const validAccessToken = `header.${'a'.repeat(60)}.signature`;
  const validRefreshToken = `refresh-${'b'.repeat(24)}`;
  const session = {
    access_token: validAccessToken,
    refresh_token: validRefreshToken,
    user: { id: 'user-1' },
  };

  beforeAll(() => {
    ({ OAuthHandler } = require('@/lib/services/OAuthHandler'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateURL.mockReturnValue('formfactor://callback');
    mockParse.mockReturnValue({ queryParams: {} });
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.test/auth' }, error: null });
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}&state=test-oauth-state-123`,
    });
    mockSetSession.mockResolvedValue({ data: { session }, error: null });
    mockExchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
  });

  it('initiates Google OAuth successfully and returns the created session', async () => {
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(mockSignInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        queryParams: {
          state: 'test-oauth-state-123',
        },
        redirectTo: 'formfactor://callback',
        skipBrowserRedirect: true,
      },
    });
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      'https://supabase.test/auth',
      'formfactor://callback'
    );
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: validAccessToken,
      refresh_token: validRefreshToken,
    });
    expect(result).toEqual({ success: true, session });
  });

  it('returns a cancellation error when the user cancels OAuth', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result).toEqual({
      success: false,
      error: 'Sign-in was cancelled',
    });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('parses tokens from both hash fragments and query params', () => {
    const handler = new OAuthHandler();

    expect(
      handler.parseTokensFromUrl(
        `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
      )
    ).toEqual({ accessToken: validAccessToken, refreshToken: validRefreshToken });

    expect(
      handler.parseTokensFromUrl(
        `formfactor://callback?accessToken=${validAccessToken}&refreshToken=${validRefreshToken}`
      )
    ).toEqual({ accessToken: validAccessToken, refreshToken: validRefreshToken });
  });

  it('validates short tokens as invalid and substantial tokens as valid', () => {
    const handler = new OAuthHandler();
    const validateTokens = (handler as unknown as {
      validateTokens(tokens: { accessToken: string; refreshToken: string }): boolean;
    }).validateTokens.bind(handler);

    expect(
      validateTokens({
        accessToken: 'too-short',
        refreshToken: 'also-too-short',
      })
    ).toBe(false);

    expect(
      validateTokens({
        accessToken: validAccessToken,
        refreshToken: validRefreshToken,
      })
    ).toBe(true);
  });

  it('handles a valid callback URL by creating a session from tokens', async () => {
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback#state=test-oauth-state-123&access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toEqual(session);
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: validAccessToken,
      refresh_token: validRefreshToken,
    });
  });
});
