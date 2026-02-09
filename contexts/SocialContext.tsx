import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { warnWithTs } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import {
  acceptFollow as acceptFollowRequest,
  blockUser as blockTargetUser,
  followUser as createFollow,
  getFollowStatus as fetchFollowStatus,
  getPendingRequestCount,
  getUnreadShareCount,
  rejectFollow as rejectFollowRequest,
  type BlockRecord,
  type FollowRecord,
  type FollowStatusSummary,
  unblockUser as unblockTargetUser,
  unfollowUser as removeFollow,
} from '@/lib/services/social-service';

type SocialContextValue = {
  followStatusCache: Record<string, FollowStatusSummary>;
  pendingRequestCount: number;
  unreadSharesCount: number;
  loadingCounts: boolean;
  refreshCounts: () => Promise<void>;
  refreshPendingRequestCount: () => Promise<number>;
  refreshUnreadShareCount: () => Promise<number>;
  clearFollowStatusCache: () => void;
  getFollowStatus: (targetId: string, opts?: { refresh?: boolean }) => Promise<FollowStatusSummary>;
  followUser: (targetId: string) => Promise<FollowRecord>;
  unfollowUser: (targetId: string) => Promise<boolean>;
  acceptFollow: (followerId: string) => Promise<FollowRecord | null>;
  rejectFollow: (followerId: string) => Promise<boolean>;
  blockUser: (targetId: string) => Promise<BlockRecord>;
  unblockUser: (targetId: string) => Promise<boolean>;
};

const SocialContext = createContext<SocialContextValue | undefined>(undefined);

function buildSelfStatus(): FollowStatusSummary {
  return {
    is_self: true,
    outgoing_status: null,
    incoming_status: null,
    follows: false,
    requested: false,
    followed_by: false,
    blocked_by_me: false,
    blocked_between: false,
  };
}

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [followStatusCache, setFollowStatusCache] = useState<Record<string, FollowStatusSummary>>({});
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [unreadSharesCount, setUnreadSharesCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const clearFollowStatusCache = useCallback(() => {
    setFollowStatusCache({});
  }, []);

  const refreshPendingRequestCount = useCallback(async () => {
    if (!user?.id) {
      setPendingRequestCount(0);
      return 0;
    }

    try {
      const count = await getPendingRequestCount();
      setPendingRequestCount(count);
      return count;
    } catch (error) {
      warnWithTs('[SocialContext] Failed to refresh pending request count', error);
      return pendingRequestCount;
    }
  }, [pendingRequestCount, user?.id]);

  const refreshUnreadShareCount = useCallback(async () => {
    if (!user?.id) {
      setUnreadSharesCount(0);
      return 0;
    }

    try {
      const count = await getUnreadShareCount();
      setUnreadSharesCount(count);
      return count;
    } catch (error) {
      warnWithTs('[SocialContext] Failed to refresh unread share count', error);
      return unreadSharesCount;
    }
  }, [unreadSharesCount, user?.id]);

  const refreshCounts = useCallback(async () => {
    if (!user?.id) {
      setPendingRequestCount(0);
      setUnreadSharesCount(0);
      setLoadingCounts(false);
      return;
    }

    setLoadingCounts(true);
    try {
      await Promise.all([refreshPendingRequestCount(), refreshUnreadShareCount()]);
    } finally {
      setLoadingCounts(false);
    }
  }, [refreshPendingRequestCount, refreshUnreadShareCount, user?.id]);

  const getFollowStatus = useCallback(
    async (targetId: string, opts?: { refresh?: boolean }): Promise<FollowStatusSummary> => {
      if (!user?.id) {
        return buildSelfStatus();
      }

      if (!targetId || targetId === user.id) {
        return buildSelfStatus();
      }

      if (!opts?.refresh && followStatusCache[targetId]) {
        return followStatusCache[targetId];
      }

      const next = await fetchFollowStatus(targetId);
      setFollowStatusCache((prev) => ({ ...prev, [targetId]: next }));
      return next;
    },
    [followStatusCache, user?.id],
  );

  const invalidateFollowStatus = useCallback((targetId: string) => {
    if (!targetId) return;
    setFollowStatusCache((prev) => {
      if (!(targetId in prev)) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, []);

  const followUser = useCallback(
    async (targetId: string) => {
      const result = await createFollow(targetId);
      await getFollowStatus(targetId, { refresh: true });
      return result;
    },
    [getFollowStatus],
  );

  const unfollowUser = useCallback(
    async (targetId: string) => {
      const result = await removeFollow(targetId);
      await getFollowStatus(targetId, { refresh: true });
      return result;
    },
    [getFollowStatus],
  );

  const acceptFollow = useCallback(
    async (followerId: string) => {
      const result = await acceptFollowRequest(followerId);
      invalidateFollowStatus(followerId);
      await refreshPendingRequestCount();
      return result;
    },
    [invalidateFollowStatus, refreshPendingRequestCount],
  );

  const rejectFollow = useCallback(
    async (followerId: string) => {
      const result = await rejectFollowRequest(followerId);
      invalidateFollowStatus(followerId);
      await refreshPendingRequestCount();
      return result;
    },
    [invalidateFollowStatus, refreshPendingRequestCount],
  );

  const blockUser = useCallback(
    async (targetId: string) => {
      const result = await blockTargetUser(targetId);
      invalidateFollowStatus(targetId);
      await refreshCounts();
      return result;
    },
    [invalidateFollowStatus, refreshCounts],
  );

  const unblockUser = useCallback(
    async (targetId: string) => {
      const result = await unblockTargetUser(targetId);
      invalidateFollowStatus(targetId);
      await refreshCounts();
      return result;
    },
    [invalidateFollowStatus, refreshCounts],
  );

  useEffect(() => {
    if (!user?.id) {
      clearFollowStatusCache();
      setPendingRequestCount(0);
      setUnreadSharesCount(0);
      return;
    }

    void refreshCounts();

    const followsChannel = supabase
      .channel(`social-follows-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'follows', filter: `following_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new || payload.old) as { follower_id?: string } | null;
          if (row?.follower_id) {
            invalidateFollowStatus(row.follower_id);
          }
          void refreshPendingRequestCount();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'follows', filter: `follower_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new || payload.old) as { following_id?: string } | null;
          if (row?.following_id) {
            invalidateFollowStatus(row.following_id);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'blocks', filter: `blocker_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new || payload.old) as { blocked_id?: string } | null;
          if (row?.blocked_id) {
            invalidateFollowStatus(row.blocked_id);
          }
          void refreshCounts();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'blocks', filter: `blocked_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new || payload.old) as { blocker_id?: string } | null;
          if (row?.blocker_id) {
            invalidateFollowStatus(row.blocker_id);
          }
          void refreshCounts();
        },
      )
      .subscribe();

    const sharesChannel = supabase
      .channel(`social-shares-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'video_shares', filter: `recipient_id=eq.${user.id}` },
        () => {
          void refreshUnreadShareCount();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(followsChannel);
      void supabase.removeChannel(sharesChannel);
    };
  }, [
    clearFollowStatusCache,
    invalidateFollowStatus,
    refreshCounts,
    refreshPendingRequestCount,
    refreshUnreadShareCount,
    user?.id,
  ]);

  const value = useMemo<SocialContextValue>(
    () => ({
      followStatusCache,
      pendingRequestCount,
      unreadSharesCount,
      loadingCounts,
      refreshCounts,
      refreshPendingRequestCount,
      refreshUnreadShareCount,
      clearFollowStatusCache,
      getFollowStatus,
      followUser,
      unfollowUser,
      acceptFollow,
      rejectFollow,
      blockUser,
      unblockUser,
    }),
    [
      acceptFollow,
      blockUser,
      clearFollowStatusCache,
      followStatusCache,
      followUser,
      getFollowStatus,
      loadingCounts,
      pendingRequestCount,
      refreshCounts,
      refreshPendingRequestCount,
      refreshUnreadShareCount,
      rejectFollow,
      unblockUser,
      unfollowUser,
      unreadSharesCount,
    ],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) {
    throw new Error('useSocial must be used within a SocialProvider');
  }
  return context;
}
