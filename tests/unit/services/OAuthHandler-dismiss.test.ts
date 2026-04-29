/**
 * OAuthHandler — A4 dismiss in-flight WebBrowser auth session when a
 * concurrent OAuth flow starts.
 *
 * We want proof that `WebBrowser.dismissAuthSession()` is called before the
 * second `initiateOAuth` overwrites `pendingOAuthState`, so any stale
 * browser sheet from the previous flow is torn down.
 */

const mockDismissAuthSession = jest.fn();
const mockMaybeCompleteAuthSession = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

const mockCreateURL = jest.fn(() => 'formfactor://callback');
const mockParse = jest.fn(() => ({ queryParams: {} }));

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
  dismissAuthSession: (...args: unknown[]) => mockDismissAuthSession(...args),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest
    .fn()
    .mockReturnValueOnce('state-1')
    .mockReturnValueOnce('state-2'),
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

jest.mock('@/lib/supabase', () => ({ supabase: mockSupabase }));
jest.mock('../../../lib/supabase', () => ({ supabase: mockSupabase }));

describe('OAuthHandler.initiateOAuth — A4 dismiss in-flight session', () => {
  let OAuthHandler: typeof import('@/lib/services/OAuthHandler')['OAuthHandler'];

  beforeAll(() => {
    ({ OAuthHandler } = require('@/lib/services/OAuthHandler'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignInWithOAuth.mockResolvedValue({
      data: { url: 'https://supabase.test/auth' },
      error: null,
    });
    // Leave openAuthSessionAsync unresolved so the flow stays in the
    // "pending" state when the second flow starts.
    mockOpenAuthSessionAsync.mockImplementation(() => new Promise(() => {}));
  });

  it('dismisses any in-flight auth session when a new flow supersedes it', async () => {
    const handler = new OAuthHandler();

    // Start flow 1 — it will hang on openAuthSessionAsync.
    void handler.initiateOAuth('google');
    // Let the signInWithOAuth promise resolve before we kick off flow 2.
    await Promise.resolve();
    await Promise.resolve();

    // Start flow 2 — should notice pendingOAuthState is not null and
    // dismiss the browser sheet before clearing state.
    void handler.initiateOAuth('apple');
    await Promise.resolve();

    expect(mockDismissAuthSession).toHaveBeenCalledTimes(1);
  });
});
