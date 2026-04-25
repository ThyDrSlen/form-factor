import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type * as SocialContextModule from '@/contexts/SocialContext';

// AuthContext mock — toggled per-test via this object
const mockAuthValue: { user: { id: string } | null; loading: boolean } = {
  user: { id: 'user-abc' },
  loading: false,
};
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

// social-service mock — gives us control over every network call
const mockSocial = {
  getFollowStatus: jest.fn(),
  getPendingRequestCount: jest.fn(),
  getUnreadShareCount: jest.fn(),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
  acceptFollow: jest.fn(),
  rejectFollow: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
};
jest.mock('@/lib/services/social-service', () => ({
  getFollowStatus: (...args: any[]) => mockSocial.getFollowStatus(...args),
  getPendingRequestCount: (...args: any[]) => mockSocial.getPendingRequestCount(...args),
  getUnreadShareCount: (...args: any[]) => mockSocial.getUnreadShareCount(...args),
  followUser: (...args: any[]) => mockSocial.followUser(...args),
  unfollowUser: (...args: any[]) => mockSocial.unfollowUser(...args),
  acceptFollow: (...args: any[]) => mockSocial.acceptFollow(...args),
  rejectFollow: (...args: any[]) => mockSocial.rejectFollow(...args),
  blockUser: (...args: any[]) => mockSocial.blockUser(...args),
  unblockUser: (...args: any[]) => mockSocial.unblockUser(...args),
}));

// Supabase realtime channel stub
const makeChannel = () => {
  const channel: any = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
  };
  return channel;
};

const mockChannel = jest.fn((..._args: any[]) => makeChannel());
const mockRemoveChannel = jest.fn((..._args: any[]) => Promise.resolve(undefined));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: (global as any).__mockSupabaseAuth,
    channel: (...args: any[]) => mockChannel(...args),
    removeChannel: (...args: any[]) => mockRemoveChannel(...args),
  },
}));

// Silence warnWithTs
jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
}));

type SocialModule = typeof SocialContextModule;
let SocialProvider: SocialModule['SocialProvider'];
let useSocial: SocialModule['useSocial'];

beforeAll(() => {
  const mod = require('@/contexts/SocialContext') as SocialModule;
  SocialProvider = mod.SocialProvider;
  useSocial = mod.useSocial;
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SocialProvider>{children}</SocialProvider>
);

const buildStatus = (overrides: Partial<any> = {}) => ({
  is_self: false,
  outgoing_status: null,
  incoming_status: null,
  follows: false,
  requested: false,
  followed_by: false,
  blocked_by_me: false,
  blocked_between: false,
  ...overrides,
});

describe('SocialContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthValue.user = { id: 'user-abc' };
    mockSocial.getPendingRequestCount.mockResolvedValue(0);
    mockSocial.getUnreadShareCount.mockResolvedValue(0);
    mockSocial.getFollowStatus.mockResolvedValue(buildStatus());
  });

  describe('initial state', () => {
    it('returns zero counts and an empty cache after init', async () => {
      const { result } = renderHook(() => useSocial(), { wrapper });

      await waitFor(() => {
        expect(result.current.loadingCounts).toBe(false);
      });

      expect(result.current.pendingRequestCount).toBe(0);
      expect(result.current.unreadSharesCount).toBe(0);
      expect(result.current.followStatusCache).toEqual({});
    });

    it('throws when used outside the provider', () => {
      // suppress the thrown-error console output
      const prevError = console.error;
      console.error = jest.fn();
      try {
        expect(() => renderHook(() => useSocial()).result.current).toThrow(
          /useSocial must be used within a SocialProvider/,
        );
      } finally {
        console.error = prevError;
      }
    });
  });

  describe('refreshCounts', () => {
    it('calls both count services when signed in', async () => {
      mockSocial.getPendingRequestCount.mockResolvedValue(3);
      mockSocial.getUnreadShareCount.mockResolvedValue(7);

      const { result } = renderHook(() => useSocial(), { wrapper });

      await waitFor(() => {
        expect(result.current.pendingRequestCount).toBe(3);
      });
      expect(result.current.unreadSharesCount).toBe(7);

      // manual call
      mockSocial.getPendingRequestCount.mockResolvedValue(5);
      mockSocial.getUnreadShareCount.mockResolvedValue(9);

      await act(async () => {
        await result.current.refreshCounts();
      });

      expect(result.current.pendingRequestCount).toBe(5);
      expect(result.current.unreadSharesCount).toBe(9);
    });

    it('zeroes counts when no user is signed in', async () => {
      mockAuthValue.user = null;
      const { result } = renderHook(() => useSocial(), { wrapper });

      await act(async () => {
        await result.current.refreshCounts();
      });

      expect(result.current.pendingRequestCount).toBe(0);
      expect(result.current.unreadSharesCount).toBe(0);
      expect(mockSocial.getPendingRequestCount).not.toHaveBeenCalled();
      expect(mockSocial.getUnreadShareCount).not.toHaveBeenCalled();
    });

    it('swallows errors and preserves previous pending-count value', async () => {
      mockSocial.getPendingRequestCount.mockResolvedValueOnce(4);
      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.pendingRequestCount).toBe(4));

      mockSocial.getPendingRequestCount.mockRejectedValueOnce(new Error('network down'));
      await act(async () => {
        const count = await result.current.refreshPendingRequestCount();
        expect(count).toBe(4);
      });
      // error swallowed; count preserved
      expect(result.current.pendingRequestCount).toBe(4);
    });

    it('swallows errors and preserves previous unread-share value', async () => {
      mockSocial.getUnreadShareCount.mockResolvedValueOnce(2);
      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.unreadSharesCount).toBe(2));

      mockSocial.getUnreadShareCount.mockRejectedValueOnce(new Error('boom'));
      await act(async () => {
        const count = await result.current.refreshUnreadShareCount();
        expect(count).toBe(2);
      });
      expect(result.current.unreadSharesCount).toBe(2);
    });
  });

  describe('followStatusCache read/write', () => {
    it('caches result of first getFollowStatus call', async () => {
      const summary = buildStatus({ follows: true });
      mockSocial.getFollowStatus.mockResolvedValueOnce(summary);

      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.loadingCounts).toBe(false));

      await act(async () => {
        await result.current.getFollowStatus('target-1');
      });

      expect(result.current.followStatusCache['target-1']).toEqual(summary);

      // Second call — should NOT hit network (cache hit)
      mockSocial.getFollowStatus.mockClear();
      await act(async () => {
        await result.current.getFollowStatus('target-1');
      });
      expect(mockSocial.getFollowStatus).not.toHaveBeenCalled();
    });

    it('refreshes cache when opts.refresh is true', async () => {
      mockSocial.getFollowStatus.mockResolvedValueOnce(buildStatus({ follows: false }));
      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.loadingCounts).toBe(false));

      await act(async () => {
        await result.current.getFollowStatus('target-1');
      });

      mockSocial.getFollowStatus.mockResolvedValueOnce(buildStatus({ follows: true }));
      await act(async () => {
        await result.current.getFollowStatus('target-1', { refresh: true });
      });
      expect(result.current.followStatusCache['target-1'].follows).toBe(true);
    });

    it('returns self-status for own userId without hitting network', async () => {
      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.loadingCounts).toBe(false));

      mockSocial.getFollowStatus.mockClear();
      let returned: any;
      await act(async () => {
        returned = await result.current.getFollowStatus('user-abc');
      });

      expect(returned.is_self).toBe(true);
      expect(mockSocial.getFollowStatus).not.toHaveBeenCalled();
    });

    it('clearFollowStatusCache empties the cache', async () => {
      mockSocial.getFollowStatus.mockResolvedValueOnce(buildStatus({ follows: true }));
      const { result } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => expect(result.current.loadingCounts).toBe(false));

      await act(async () => {
        await result.current.getFollowStatus('target-1');
      });
      expect(Object.keys(result.current.followStatusCache)).toHaveLength(1);

      act(() => {
        result.current.clearFollowStatusCache();
      });
      expect(result.current.followStatusCache).toEqual({});
    });
  });

  describe('realtime channel lifecycle', () => {
    it('subscribes to follows and shares channels when user is signed in', async () => {
      renderHook(() => useSocial(), { wrapper });

      await waitFor(() => {
        expect(mockChannel).toHaveBeenCalledWith(expect.stringMatching(/^social-follows-/));
      });
      expect(mockChannel).toHaveBeenCalledWith(expect.stringMatching(/^social-shares-/));
    });

    it('does not subscribe when no user is present', async () => {
      mockAuthValue.user = null;
      renderHook(() => useSocial(), { wrapper });

      // allow microtasks
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockChannel).not.toHaveBeenCalled();
    });

    it('tears down channels on unmount', async () => {
      const { unmount } = renderHook(() => useSocial(), { wrapper });
      await waitFor(() => {
        expect(mockChannel).toHaveBeenCalled();
      });

      unmount();
      expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
    });
  });
});
