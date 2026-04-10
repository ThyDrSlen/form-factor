// ---------------------------------------------------------------------------
// Supabase chain builder — every method call returns the proxy itself.
// When awaited (`.then()`), the chain resolves with `resolveValue`.
// This correctly supports arbitrarily deep chains like:
//   supabase.from('x').select('y').eq('a', 1).eq('b', 2).order('c').limit(N)
// ---------------------------------------------------------------------------

function buildChain(resolveValue: Record<string, unknown> = { data: null, error: null }): any {
  const handler: ProxyHandler<Record<string, any>> = {
    get(_target, prop: string) {
      if (prop === 'then') {
        return (onFulfilled: (v: unknown) => void) =>
          Promise.resolve(resolveValue).then(onFulfilled);
      }
      if (prop === 'catch' || prop === 'finally') {
        return () => Promise.resolve(resolveValue);
      }
      return jest.fn((..._args: unknown[]) => new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockStorageFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
  },
}));

jest.mock('@/lib/auth-utils', () => ({
  ensureUser: jest.fn(async () => {
    const { data, error } = await mockGetUser();
    if (error) throw error;
    if (!data?.user) throw new Error('Not signed in');
    return data.user;
  }),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('@/lib/services/ErrorHandler', () => ({
  createError: jest.fn((domain: string, code: string, message: string, opts?: any) => ({
    domain,
    code,
    message,
    retryable: opts?.retryable ?? false,
  })),
}));

jest.mock('@/lib/services/video-service', () => ({}));

const ME = { id: 'me-123' };
const OTHER = { id: 'other-456' };

function setCurrentUser(user = ME) {
  mockGetUser.mockResolvedValue({ data: { user }, error: null });
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

let socialService: typeof import('@/lib/services/social-service');

describe('social-service', () => {
  beforeAll(() => {
    socialService = require('@/lib/services/social-service');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setCurrentUser();
  });

  // =========================================================================
  // getProfile
  // =========================================================================

  describe('getProfile', () => {
    it('fetches the current user profile when no userId is given', async () => {
      mockFrom.mockReturnValue(
        buildChain({ data: { user_id: ME.id, username: 'me' }, error: null })
      );

      const result = await socialService.getProfile();

      expect(result).toMatchObject({ user_id: ME.id });
      expect(mockFrom).toHaveBeenCalledWith('profiles');
    });

    it('fetches a specific user profile by userId', async () => {
      mockFrom.mockReturnValue(
        buildChain({ data: { user_id: OTHER.id, username: 'other' }, error: null })
      );

      const result = await socialService.getProfile(OTHER.id);

      expect(result).toMatchObject({ user_id: OTHER.id });
    });

    it('returns null when the profile does not exist', async () => {
      mockFrom.mockReturnValue(buildChain({ data: null, error: null }));

      const result = await socialService.getProfile(OTHER.id);

      expect(result).toBeNull();
    });

    it('throws on Supabase error', async () => {
      mockFrom.mockReturnValue(buildChain({ data: null, error: new Error('DB down') }));

      await expect(socialService.getProfile()).rejects.toThrow('DB down');
    });
  });

  // =========================================================================
  // updateProfile
  // =========================================================================

  describe('updateProfile', () => {
    it('updates username as lowercase trimmed', async () => {
      mockFrom.mockReturnValue(
        buildChain({ data: { user_id: ME.id, username: 'newname' }, error: null })
      );

      const result = await socialService.updateProfile({ username: '  NewName  ' });

      expect(result).toMatchObject({ username: 'newname' });
    });

    it('rejects empty username with EMPTY_USERNAME', async () => {
      await expect(socialService.updateProfile({ username: '   ' })).rejects.toMatchObject({
        code: 'EMPTY_USERNAME',
      });
    });

    it('returns existing profile when no fields are changed', async () => {
      const existing = { user_id: ME.id, username: 'me', display_name: null };
      mockFrom.mockReturnValue(buildChain({ data: existing, error: null }));

      const result = await socialService.updateProfile({});

      expect(result).toMatchObject({ user_id: ME.id });
    });

    it('throws PROFILE_NOT_FOUND when empty patch and profile missing', async () => {
      mockFrom.mockReturnValue(buildChain({ data: null, error: null }));

      await expect(socialService.updateProfile({})).rejects.toMatchObject({
        code: 'PROFILE_NOT_FOUND',
      });
    });

    it('trims display_name to null when whitespace-only', async () => {
      let capturedUpdate: Record<string, unknown> = {};
      mockFrom.mockImplementation(() => {
        const updateMock = jest.fn((payload: Record<string, unknown>) => {
          capturedUpdate = payload;
          return buildChain({ data: { user_id: ME.id, display_name: null }, error: null });
        });
        return { update: updateMock };
      });

      await socialService.updateProfile({ display_name: '   ' });

      expect(capturedUpdate).toMatchObject({ display_name: null });
    });
  });

  // =========================================================================
  // searchUsers
  // =========================================================================

  describe('searchUsers', () => {
    it('returns empty array for whitespace-only query', async () => {
      const result = await socialService.searchUsers('   ');

      expect(result).toEqual([]);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('queries profiles by username or display_name', async () => {
      const profiles = [{ user_id: 'u1', username: 'alice' }];
      mockFrom.mockReturnValue(buildChain({ data: profiles, error: null }));

      const result = await socialService.searchUsers('alice');

      expect(result).toHaveLength(1);
      expect(mockFrom).toHaveBeenCalledWith('profiles');
    });
  });

  // =========================================================================
  // followUser
  // =========================================================================

  describe('followUser', () => {
    it('prevents self-follow with SELF_FOLLOW error', async () => {
      await expect(socialService.followUser(ME.id)).rejects.toMatchObject({
        code: 'SELF_FOLLOW',
      });
    });

    it('creates a follow with accepted status for public profiles', async () => {
      const followRecord = {
        follower_id: ME.id,
        following_id: OTHER.id,
        status: 'accepted',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return buildChain({ data: { user_id: OTHER.id, is_private: false }, error: null });
        }
        if (callIndex === 2) {
          return buildChain({ data: null, error: null });
        }
        return buildChain({ data: followRecord, error: null });
      });

      const result = await socialService.followUser(OTHER.id);

      expect(result).toMatchObject({ status: 'accepted' });
    });

    it('creates a pending follow for private profiles', async () => {
      const followRecord = {
        follower_id: ME.id,
        following_id: OTHER.id,
        status: 'pending',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return buildChain({ data: { user_id: OTHER.id, is_private: true }, error: null });
        }
        if (callIndex === 2) {
          return buildChain({ data: null, error: null });
        }
        return buildChain({ data: followRecord, error: null });
      });

      const result = await socialService.followUser(OTHER.id);

      expect(result.status).toBe('pending');
    });

    it('returns existing follow when already accepted', async () => {
      const existingFollow = {
        follower_id: ME.id,
        following_id: OTHER.id,
        status: 'accepted',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return buildChain({ data: { user_id: OTHER.id, is_private: false }, error: null });
        }
        return buildChain({ data: existingFollow, error: null });
      });

      const result = await socialService.followUser(OTHER.id);

      expect(result.status).toBe('accepted');
    });
  });

  // =========================================================================
  // unfollowUser
  // =========================================================================

  describe('unfollowUser', () => {
    it('deletes the follow relationship and returns true', async () => {
      mockFrom.mockReturnValue(buildChain({ error: null }));

      const result = await socialService.unfollowUser(OTHER.id);

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // blockUser / unblockUser
  // =========================================================================

  describe('blockUser', () => {
    it('prevents self-block with SELF_BLOCK error', async () => {
      await expect(socialService.blockUser(ME.id)).rejects.toMatchObject({
        code: 'SELF_BLOCK',
      });
    });

    it('upserts a block record', async () => {
      const blockRecord = {
        blocker_id: ME.id,
        blocked_id: OTHER.id,
        created_at: '2024-01-01',
      };
      mockFrom.mockReturnValue(buildChain({ data: blockRecord, error: null }));

      const result = await socialService.blockUser(OTHER.id);

      expect(result).toMatchObject({ blocker_id: ME.id, blocked_id: OTHER.id });
    });
  });

  describe('unblockUser', () => {
    it('deletes the block record and returns true', async () => {
      mockFrom.mockReturnValue(buildChain({ error: null }));

      const result = await socialService.unblockUser(OTHER.id);

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // getFollowCounts (parallel queries)
  // =========================================================================

  describe('getFollowCounts', () => {
    it('returns followers, following, and pending counts in parallel', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        const counts = [10, 5, 2];
        const idx = Math.min(callIndex - 1, counts.length - 1);
        return buildChain({ count: counts[idx], error: null });
      });

      const result = await socialService.getFollowCounts();

      expect(result).toEqual({ followers: 10, following: 5, pending_requests: 2 });
    });

    it('fetches counts for a specific user', async () => {
      mockFrom.mockReturnValue(buildChain({ count: 0, error: null }));

      const result = await socialService.getFollowCounts(OTHER.id);

      expect(result).toEqual({ followers: 0, following: 0, pending_requests: 0 });
    });

    it('throws when one of the parallel queries fails', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          return buildChain({ count: null, error: new Error('query failed') });
        }
        return buildChain({ count: 3, error: null });
      });

      await expect(socialService.getFollowCounts()).rejects.toThrow('query failed');
    });
  });

  // =========================================================================
  // getFollowStatus
  // =========================================================================

  describe('getFollowStatus', () => {
    it('returns is_self=true when checking own status', async () => {
      const result = await socialService.getFollowStatus(ME.id);

      expect(result).toMatchObject({
        is_self: true,
        follows: false,
        requested: false,
        followed_by: false,
        blocked_by_me: false,
        blocked_between: false,
      });
    });

    it('returns full status for another user', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return buildChain({ data: { status: 'accepted' }, error: null });
        if (callIndex === 2) return buildChain({ data: { status: 'pending' }, error: null });
        return buildChain({ data: null, error: null }); // blocks
      });
      mockRpc.mockResolvedValue({ data: false, error: null });

      const result = await socialService.getFollowStatus(OTHER.id);

      expect(result).toMatchObject({
        is_self: false,
        outgoing_status: 'accepted',
        incoming_status: 'pending',
        follows: true,
        requested: false,
        followed_by: false,
        blocked_by_me: false,
        blocked_between: false,
      });
    });

    it('detects blocked_by_me and blocked_between', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 3) {
          // blocked by me
          return buildChain({ data: { blocker_id: ME.id }, error: null });
        }
        return buildChain({ data: null, error: null });
      });
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await socialService.getFollowStatus(OTHER.id);

      expect(result.blocked_by_me).toBe(true);
      expect(result.blocked_between).toBe(true);
    });
  });

  // =========================================================================
  // shareVideo
  // =========================================================================

  describe('shareVideo', () => {
    it('prevents self-share with SELF_SHARE error', async () => {
      await expect(
        socialService.shareVideo('vid-1', ME.id, 'Check this out')
      ).rejects.toMatchObject({ code: 'SELF_SHARE' });
    });

    it('creates a share record', async () => {
      const shareRecord = {
        id: 'share-1',
        video_id: 'vid-1',
        sender_id: ME.id,
        recipient_id: OTHER.id,
        message: 'Nice form!',
        read_at: null,
        created_at: '2024-01-01',
      };
      mockFrom.mockReturnValue(buildChain({ data: shareRecord, error: null }));

      const result = await socialService.shareVideo('vid-1', OTHER.id, 'Nice form!');

      expect(result).toMatchObject({ id: 'share-1', sender_id: ME.id });
    });
  });

  // =========================================================================
  // markShareRead
  // =========================================================================

  describe('markShareRead', () => {
    it('marks an unread share as read', async () => {
      const shareRecord = {
        id: 'share-1',
        read_at: '2024-01-01T12:00:00Z',
      };
      mockFrom.mockReturnValue(buildChain({ data: shareRecord, error: null }));

      const result = await socialService.markShareRead('share-1');

      expect(result).toMatchObject({ id: 'share-1' });
    });

    it('falls back to fetching existing record when already read', async () => {
      const existingShare = { id: 'share-1', read_at: '2024-01-01T10:00:00Z' };
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return buildChain({ data: null, error: null });
        return buildChain({ data: existingShare, error: null });
      });

      const result = await socialService.markShareRead('share-1');

      expect(result).toMatchObject({ id: 'share-1' });
    });
  });

  // =========================================================================
  // getUnreadShareCount
  // =========================================================================

  describe('getUnreadShareCount', () => {
    it('returns the count of unread shares', async () => {
      mockFrom.mockReturnValue(buildChain({ count: 3, error: null }));

      const result = await socialService.getUnreadShareCount();

      expect(result).toBe(3);
    });

    it('returns 0 when count is null', async () => {
      mockFrom.mockReturnValue(buildChain({ count: null, error: null }));

      const result = await socialService.getUnreadShareCount();

      expect(result).toBe(0);
    });
  });

  // =========================================================================
  // replyToShare
  // =========================================================================

  describe('replyToShare', () => {
    it('rejects empty reply with EMPTY_REPLY error', async () => {
      await expect(socialService.replyToShare('share-1', '   ')).rejects.toMatchObject({
        code: 'EMPTY_REPLY',
      });
    });

    it('creates a reply record', async () => {
      const reply = {
        id: 'reply-1',
        share_id: 'share-1',
        user_id: ME.id,
        message: 'Thanks!',
        created_at: '2024-01-01',
      };
      mockFrom.mockReturnValue(buildChain({ data: reply, error: null }));

      const result = await socialService.replyToShare('share-1', 'Thanks!');

      expect(result).toMatchObject({ id: 'reply-1', message: 'Thanks!' });
    });
  });

  // =========================================================================
  // acceptFollow / rejectFollow
  // =========================================================================

  describe('acceptFollow', () => {
    it('updates the follow status to accepted', async () => {
      const record = {
        follower_id: OTHER.id,
        following_id: ME.id,
        status: 'accepted',
      };
      mockFrom.mockReturnValue(buildChain({ data: record, error: null }));

      const result = await socialService.acceptFollow(OTHER.id);

      expect(result).toMatchObject({ status: 'accepted' });
    });

    it('returns null when no pending follow exists', async () => {
      mockFrom.mockReturnValue(buildChain({ data: null, error: null }));

      const result = await socialService.acceptFollow(OTHER.id);

      expect(result).toBeNull();
    });
  });

  describe('rejectFollow', () => {
    it('deletes the pending follow and returns true', async () => {
      mockFrom.mockReturnValue(buildChain({ error: null }));

      const result = await socialService.rejectFollow(OTHER.id);

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // getSharedInbox (pagination cursor)
  // =========================================================================

  describe('getSharedInbox', () => {
    function setupHydrationMocks(sharesData: unknown[]) {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'video_shares') {
          return buildChain({ data: sharesData, error: null });
        }
        // profiles and videos for hydration
        return buildChain({ data: [], error: null });
      });
      mockStorageFrom.mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed.url' },
          error: null,
        }),
      });
    }

    it('returns items with nextCursor when more data exists', async () => {
      const shares = Array.from({ length: 21 }, (_, i) => ({
        id: `share-${i}`,
        video_id: `vid-${i}`,
        sender_id: OTHER.id,
        recipient_id: ME.id,
        message: null,
        read_at: null,
        created_at: `2024-01-${String(21 - i).padStart(2, '0')}`,
      }));
      setupHydrationMocks(shares);

      const result = await socialService.getSharedInbox(null, 20);

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBeTruthy();
    });

    it('returns null cursor when no more data', async () => {
      const shares = [
        {
          id: 'share-1',
          video_id: 'vid-1',
          sender_id: OTHER.id,
          recipient_id: ME.id,
          message: null,
          read_at: null,
          created_at: '2024-01-01',
        },
      ];
      setupHydrationMocks(shares);

      const result = await socialService.getSharedInbox(null, 20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });
  });

  // =========================================================================
  // getMutualFollowProfiles
  // =========================================================================

  describe('getMutualFollowProfiles', () => {
    it('returns profiles that follow each other', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation((table: string) => {
        callIndex++;
        if (table === 'follows' && callIndex === 1) {
          return buildChain({
            data: [{ following_id: OTHER.id }, { following_id: 'user-789' }],
            error: null,
          });
        }
        if (table === 'follows' && callIndex === 2) {
          return buildChain({
            data: [{ follower_id: OTHER.id }],
            error: null,
          });
        }
        // Profiles lookup
        return buildChain({
          data: [{ user_id: OTHER.id, username: 'other' }],
          error: null,
        });
      });

      const result = await socialService.getMutualFollowProfiles();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ user_id: OTHER.id });
    });

    it('returns empty array when no mutuals exist', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return buildChain({ data: [{ following_id: 'user-A' }], error: null });
        }
        return buildChain({ data: [{ follower_id: 'user-B' }], error: null });
      });

      const result = await socialService.getMutualFollowProfiles();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getBlockedUsers
  // =========================================================================

  describe('getBlockedUsers', () => {
    it('returns blocked user profiles with enrichment', async () => {
      let callIndex = 0;
      mockFrom.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return buildChain({
            data: [{ blocker_id: ME.id, blocked_id: OTHER.id, created_at: '2024-01-01' }],
            error: null,
          });
        }
        return buildChain({
          data: [{ user_id: OTHER.id, username: 'blocked-user' }],
          error: null,
        });
      });

      const result = await socialService.getBlockedUsers();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        blocked_id: OTHER.id,
        profile: { user_id: OTHER.id },
      });
    });
  });
});
