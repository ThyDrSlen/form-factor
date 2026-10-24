import AsyncStorage from '@react-native-async-storage/async-storage';

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
let MAGIC_LINK_PENDING_KEY: typeof import('@/lib/services/OAuthHandler')['MAGIC_LINK_PENDING_KEY'];

describe('OAuthHandler', () => {
  const validAccessToken = `header.${'a'.repeat(60)}.signature`;
  const validRefreshToken = `refresh-${'b'.repeat(24)}`;
  const session = {
    access_token: validAccessToken,
    refresh_token: validRefreshToken,
    user: { id: 'user-1' },
  };

  beforeAll(() => {
    ({
      OAuthHandler,
      MAGIC_LINK_PENDING_KEY,
    } = require('@/lib/services/OAuthHandler'));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
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
        redirectTo: 'formfactor://callback?state=test-oauth-state-123',
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

  it.each(['implicit', 'pkce'])('round-trips app state via redirectTo in the Supabase %s callback', async (flow) => {
    // Supabase owns provider state. It preserves redirectTo's query, then
    // appends session tokens (implicit) or its authorization code (PKCE).
    mockOpenAuthSessionAsync.mockImplementation(async () => {
      const { options } = mockSignInWithOAuth.mock.calls[0][0];
      const callback = new URL(options.redirectTo);
      if (flow === 'implicit') {
        callback.hash = `access_token=${validAccessToken}&refresh_token=${validRefreshToken}`;
      } else {
        callback.searchParams.set('code', 'supabase-auth-code');
      }
      return { type: 'success', url: callback.toString() };
    });

    const result = await new OAuthHandler().initiateOAuth('google');

    expect(result).toEqual({ success: true, session });
    const { options } = mockSignInWithOAuth.mock.calls[0][0];
    expect(options.queryParams?.state).toBeUndefined();
    expect(new URL(options.redirectTo).searchParams.get('state')).toBe('test-oauth-state-123');
    if (flow === 'pkce') expect(mockExchangeCodeForSession).toHaveBeenCalledWith('supabase-auth-code');
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

  it('accepts Supabase opaque 12-character refresh tokens instead of rejecting a valid login locally', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: `formfactor://callback?state=test-oauth-state-123#access_token=${validAccessToken}&refresh_token=Ab12Cd34Ef56`,
    });

    expect(await new OAuthHandler().initiateOAuth('google')).toEqual({ success: true, session });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: validAccessToken,
      refresh_token: 'Ab12Cd34Ef56',
    });
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

  it('handles an OAuth callback after cold start using persisted state', async () => {
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const coldStartHandler = new OAuthHandler();
    const result = await coldStartHandler.handleCallback(
      `formfactor://callback#state=test-oauth-state-123&access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toEqual(session);
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: validAccessToken,
      refresh_token: validRefreshToken,
    });
  });

  // ---------------------------------------------------------------------------
  // Apple OAuth
  // ---------------------------------------------------------------------------

  it('initiates Apple OAuth with the apple provider', async () => {
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('apple');

    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'apple' })
    );
    expect(result).toEqual({ success: true, session });
  });

  // ---------------------------------------------------------------------------
  // Error states
  // ---------------------------------------------------------------------------

  it('returns error when Supabase signInWithOAuth fails', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: 'Provider not configured' },
    });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to start google sign-in');
  });

  it('returns error when no OAuth URL is returned', async () => {
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: null,
    });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No authentication URL');
  });

  it('returns error when browser result is dismissed', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toContain('dismissed');
  });

  it('returns error for unexpected browser result types', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type: 'locked' });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected OAuth result');
  });

  it('handles unexpected exceptions during OAuth flow', async () => {
    mockSignInWithOAuth.mockRejectedValue(new Error('Network timeout'));
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('handles non-Error exceptions gracefully', async () => {
    mockSignInWithOAuth.mockRejectedValue('string error');
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toBe('An unexpected error occurred');
  });

  // ---------------------------------------------------------------------------
  // handleCallback edge cases
  // ---------------------------------------------------------------------------

  it('returns null when callback has no state parameter', async () => {
    const handler = new OAuthHandler();
    // Must initiate OAuth first to set pendingOAuthState
    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    // No state in the URL, so validation fails
    expect(result).toBeNull();
  });

  it('returns null when callback state does not match pending state', async () => {
    const handler = new OAuthHandler();
    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback#state=wrong-state&access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toBeNull();
  });

  it('returns null when callback includes state but no pending OAuth state exists', async () => {
    const handler = new OAuthHandler();

    const result = await handler.handleCallback(
      `formfactor://callback#state=stale-state&access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toBeNull();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('accepts no-state magic-link token callbacks only after a pending magic-link intent', async () => {
    const handler = new OAuthHandler();
    await handler.markMagicLinkPending();

    const result = await handler.handleCallback(
      `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toEqual(session);
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: validAccessToken,
      refresh_token: validRefreshToken,
    });
  });

  it('rejects no-state token callbacks without a pending magic-link intent', async () => {
    const handler = new OAuthHandler();

    const result = await handler.handleCallback(
      `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toBeNull();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it('rejects expired pending intents and clears them', async () => {
    const handler = new OAuthHandler();
    await AsyncStorage.setItem(
      MAGIC_LINK_PENDING_KEY,
      JSON.stringify({ value: 'pending', createdAt: Date.now() - 11 * 60 * 1000 })
    );

    const result = await handler.handleCallback(
      `formfactor://callback#access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toBeNull();
    expect(mockSetSession).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(MAGIC_LINK_PENDING_KEY)).resolves.toBeNull();
  });

  it('returns null when setSession fails after token extraction', async () => {
    mockSetSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid token' } });
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback#state=test-oauth-state-123&access_token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );

    expect(result).toBeNull();
  });

  it('exchanges authorization code via PKCE flow when no tokens in URL', async () => {
    mockParse.mockReturnValue({ queryParams: { code: 'auth-code-xyz' } });
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    // URL has state but no access_token/refresh_token
    const result = await handler.handleCallback(
      `formfactor://callback?state=test-oauth-state-123&code=auth-code-xyz`
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('auth-code-xyz');
    expect(result).toEqual(session);
  });

  it('falls back to direct URL parsing when Linking.parse omits the authorization code', async () => {
    mockParse.mockReturnValue({ queryParams: {} });
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      'formfactor://callback?state=test-oauth-state-123&code=fallback-code'
    );

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('fallback-code');
    expect(result).toEqual(session);
  });

  it('returns null when code exchange fails', async () => {
    mockParse.mockReturnValue({ queryParams: { code: 'bad-code' } });
    mockExchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid code' },
    });
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback?state=test-oauth-state-123&code=bad-code`
    );

    expect(result).toBeNull();
  });

  it('returns null when callback URL has neither tokens nor code', async () => {
    mockParse.mockReturnValue({ queryParams: {} });
    const handler = new OAuthHandler();

    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
    void handler.initiateOAuth('google');
    await Promise.resolve();

    const result = await handler.handleCallback(
      `formfactor://callback?state=test-oauth-state-123`
    );

    expect(result).toBeNull();
  });

  it('returns failure when token extraction succeeds but session has no tokens', async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'formfactor://callback#state=test-oauth-state-123',
    });
    mockParse.mockReturnValue({ queryParams: {} });
    const handler = new OAuthHandler();

    const result = await handler.initiateOAuth('google');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to extract session');
  });

  // ---------------------------------------------------------------------------
  // parseTokensFromUrl edge cases
  // ---------------------------------------------------------------------------

  it('returns null when URL has no hash or query parameters', () => {
    const handler = new OAuthHandler();
    expect(handler.parseTokensFromUrl('formfactor://callback')).toBeNull();
  });

  it('returns null when URL has access_token but no refresh_token', () => {
    const handler = new OAuthHandler();
    expect(
      handler.parseTokensFromUrl(`formfactor://callback#access_token=${validAccessToken}`)
    ).toBeNull();
  });

  it('parses tokens using the "token" alias', () => {
    const handler = new OAuthHandler();
    const result = handler.parseTokensFromUrl(
      `formfactor://callback#token=${validAccessToken}&refresh_token=${validRefreshToken}`
    );
    expect(result).toEqual({
      accessToken: validAccessToken,
      refreshToken: validRefreshToken,
    });
  });

  // ---------------------------------------------------------------------------
  // getRedirectUrl
  // ---------------------------------------------------------------------------

  it('returns the configured redirect URL', () => {
    const handler = new OAuthHandler();
    expect(handler.getRedirectUrl()).toBe('formfactor://callback');
  });
});
