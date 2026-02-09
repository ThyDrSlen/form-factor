import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';
import type { VideoWithUrls } from '@/lib/services/video-service';

const VIDEO_BUCKET = 'videos';
const THUMBNAIL_BUCKET = 'video-thumbnails';
const DEFAULT_SIGNED_URL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

const PROFILE_SELECT_FIELDS =
  'user_id, username, display_name, avatar_url, bio, is_private, created_at, updated_at';
const FOLLOW_SELECT_FIELDS = 'follower_id, following_id, status, created_at, updated_at';
const BLOCK_SELECT_FIELDS = 'blocker_id, blocked_id, created_at';
const SHARE_SELECT_FIELDS = 'id, video_id, sender_id, recipient_id, message, read_at, created_at';
const SHARE_REPLY_SELECT_FIELDS = 'id, share_id, user_id, message, created_at';
const VIDEO_SELECT_WITH_COUNTS =
  'id, user_id, path, thumbnail_path, duration_seconds, exercise, metrics, created_at, video_likes(count), video_comments(count)';

export type ProfileRecord = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
};

export type UpdateProfileInput = {
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  is_private?: boolean;
};

export type FollowStatus = 'pending' | 'accepted';

export type FollowRecord = {
  follower_id: string;
  following_id: string;
  status: FollowStatus;
  created_at: string;
  updated_at: string;
};

export type FollowRelationship = FollowRecord & {
  profile: ProfileRecord | null;
};

export type FollowCounts = {
  followers: number;
  following: number;
  pending_requests: number;
};

export type FollowStatusSummary = {
  is_self: boolean;
  outgoing_status: FollowStatus | null;
  incoming_status: FollowStatus | null;
  follows: boolean;
  requested: boolean;
  followed_by: boolean;
  blocked_by_me: boolean;
  blocked_between: boolean;
};

export type BlockRecord = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

export type BlockedRelationship = BlockRecord & {
  profile: ProfileRecord | null;
};

export type VideoShareRecord = {
  id: string;
  video_id: string;
  sender_id: string;
  recipient_id: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
};

export type ShareReplyRecord = {
  id: string;
  share_id: string;
  user_id: string;
  message: string;
  created_at: string;
};

export type ShareReplyWithProfile = ShareReplyRecord & {
  profile: ProfileRecord | null;
};

export type VideoShareWithContext = VideoShareRecord & {
  sender_profile: ProfileRecord | null;
  recipient_profile: ProfileRecord | null;
  video: VideoWithUrls | null;
};

export type ShareThread = {
  share: VideoShareWithContext | null;
  replies: ShareReplyWithProfile[];
};

export type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
};

type CountAggregateRow = { count: number | null };

type VideoRowWithCounts = {
  id: string;
  user_id: string;
  path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  exercise: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
  video_likes?: CountAggregateRow[] | null;
  video_comments?: CountAggregateRow[] | null;
};

function clampLimit(limit?: number, fallback = DEFAULT_PAGE_LIMIT) {
  if (!Number.isFinite(limit) || !limit) return fallback;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

function trimToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractAggregateCount(rows: CountAggregateRow[] | null | undefined): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const value = rows[0]?.count;
  return typeof value === 'number' ? value : null;
}

async function ensureUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not signed in');
  return data.user;
}

async function safeGetSignedVideoUrl(path: string, videoId: string, expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS) {
  try {
    const { data, error } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data?.signedUrl;
  } catch (error) {
    if (__DEV__) {
      warnWithTs(`[social-service] Failed to sign video URL for ${videoId}`, error);
    }
    return undefined;
  }
}

async function safeGetSignedThumbnailUrl(
  path: string | null,
  videoId: string,
  expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS,
) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(THUMBNAIL_BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch (error) {
    if (__DEV__) {
      warnWithTs(`[social-service] Failed to sign thumbnail URL for ${videoId}`, error);
    }
    return null;
  }
}

async function getProfilesByUserIds(userIds: string[]): Promise<Map<string, ProfileRecord>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .in('user_id', ids);

  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.user_id, profile as ProfileRecord]));
}

async function enrichVideos(rows: VideoRowWithCounts[]): Promise<VideoWithUrls[]> {
  if (rows.length === 0) return [];

  const profilesById = await getProfilesByUserIds(rows.map((row) => row.user_id));

  const videos = await Promise.all(
    rows.map(async (row) => {
      const profile = profilesById.get(row.user_id) ?? null;
      const likeCount = extractAggregateCount(row.video_likes);
      const commentCount = extractAggregateCount(row.video_comments);
      const [signedUrl, thumbnailUrl] = await Promise.all([
        safeGetSignedVideoUrl(row.path, row.id),
        safeGetSignedThumbnailUrl(row.thumbnail_path, row.id),
      ]);

      return {
        id: row.id,
        user_id: row.user_id,
        path: row.path,
        thumbnail_path: row.thumbnail_path,
        duration_seconds: row.duration_seconds,
        exercise: row.exercise,
        metrics: row.metrics,
        created_at: row.created_at,
        like_count: likeCount,
        comment_count: commentCount,
        username: profile?.username ?? null,
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        signedUrl,
        thumbnailUrl,
      } as VideoWithUrls;
    }),
  );

  return videos;
}

async function getVideosByIds(videoIds: string[]) {
  const ids = Array.from(new Set(videoIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, VideoWithUrls>();

  const { data, error } = await supabase
    .from('videos')
    .select(VIDEO_SELECT_WITH_COUNTS)
    .in('id', ids);

  if (error) throw error;

  const rows = (data || []) as VideoRowWithCounts[];
  const enriched = await enrichVideos(rows);
  return new Map(enriched.map((video) => [video.id, video]));
}

function escapeOrValue(value: string) {
  return value.replace(/,/g, '\\,').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

async function hydrateFollows(records: FollowRecord[], side: 'follower' | 'following'): Promise<FollowRelationship[]> {
  const profileIds = records.map((record) => (side === 'follower' ? record.follower_id : record.following_id));
  const profilesById = await getProfilesByUserIds(profileIds);

  return records.map((record) => {
    const profileId = side === 'follower' ? record.follower_id : record.following_id;
    return {
      ...record,
      profile: profilesById.get(profileId) ?? null,
    };
  });
}

async function hydrateShares(shares: VideoShareRecord[]): Promise<VideoShareWithContext[]> {
  if (shares.length === 0) return [];

  const profileIds = shares.flatMap((share) => [share.sender_id, share.recipient_id]);
  const [profilesById, videosById] = await Promise.all([
    getProfilesByUserIds(profileIds),
    getVideosByIds(shares.map((share) => share.video_id)),
  ]);

  return shares.map((share) => ({
    ...share,
    sender_profile: profilesById.get(share.sender_id) ?? null,
    recipient_profile: profilesById.get(share.recipient_id) ?? null,
    video: videosById.get(share.video_id) ?? null,
  }));
}

export async function getProfile(userId?: string): Promise<ProfileRecord | null> {
  const resolvedUserId = userId ?? (await ensureUser()).id;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .eq('user_id', resolvedUserId)
    .maybeSingle();

  if (error) throw error;
  return (data as ProfileRecord | null) ?? null;
}

export async function updateProfile(patch: UpdateProfileInput): Promise<ProfileRecord> {
  const user = await ensureUser();

  const update: Record<string, unknown> = {};

  if (patch.username !== undefined) {
    const username = patch.username.trim().toLowerCase();
    if (!username) {
      throw new Error('Username cannot be empty');
    }
    update.username = username;
  }

  if (patch.display_name !== undefined) {
    update.display_name = trimToNull(patch.display_name);
  }

  if (patch.avatar_url !== undefined) {
    update.avatar_url = trimToNull(patch.avatar_url);
  }

  if (patch.bio !== undefined) {
    update.bio = trimToNull(patch.bio);
  }

  if (patch.is_private !== undefined) {
    update.is_private = patch.is_private;
  }

  if (Object.keys(update).length === 0) {
    const existing = await getProfile(user.id);
    if (!existing) {
      throw new Error('Profile not found');
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('user_id', user.id)
    .select(PROFILE_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data as ProfileRecord;
}

export async function searchUsers(query: string, limit = DEFAULT_PAGE_LIMIT): Promise<ProfileRecord[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const safe = escapeOrValue(trimmed);
  const pattern = `%${safe}%`;
  const pageSize = clampLimit(limit);

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_FIELDS)
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .order('username', { ascending: true })
    .limit(pageSize);

  if (error) throw error;
  return (data || []) as ProfileRecord[];
}

export async function followUser(targetId: string): Promise<FollowRecord> {
  const user = await ensureUser();
  if (user.id === targetId) {
    throw new Error('You cannot follow yourself');
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from('profiles')
    .select('user_id, is_private')
    .eq('user_id', targetId)
    .maybeSingle();

  if (targetProfileError) throw targetProfileError;

  const { data: existing, error: existingError } = await supabase
    .from('follows')
    .select(FOLLOW_SELECT_FIELDS)
    .eq('follower_id', user.id)
    .eq('following_id', targetId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.status === 'accepted') {
    return existing as FollowRecord;
  }

  // If profile visibility is restricted (private + not accepted yet), the read above can be null.
  // Default to pending in that case so follow requests still work under stricter profile RLS.
  const desiredStatus: FollowStatus = targetProfile?.is_private ? 'pending' : targetProfile ? 'accepted' : 'pending';

  if (existing?.status === desiredStatus) {
    return existing as FollowRecord;
  }

  const payload = {
    follower_id: user.id,
    following_id: targetId,
    status: desiredStatus,
  };

  const { data, error } = existing
    ? await supabase
        .from('follows')
        .update({ status: desiredStatus })
        .eq('follower_id', user.id)
        .eq('following_id', targetId)
        .select(FOLLOW_SELECT_FIELDS)
        .single()
    : await supabase
        .from('follows')
        .insert(payload)
        .select(FOLLOW_SELECT_FIELDS)
        .single();

  if (error) throw error;
  return data as FollowRecord;
}

export async function unfollowUser(targetId: string): Promise<boolean> {
  const user = await ensureUser();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', user.id)
    .eq('following_id', targetId);

  if (error) throw error;
  return true;
}

export async function acceptFollow(followerId: string): Promise<FollowRecord | null> {
  const user = await ensureUser();
  const { data, error } = await supabase
    .from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', followerId)
    .eq('following_id', user.id)
    .eq('status', 'pending')
    .select(FOLLOW_SELECT_FIELDS)
    .maybeSingle();

  if (error) throw error;
  return (data as FollowRecord | null) ?? null;
}

export async function rejectFollow(followerId: string): Promise<boolean> {
  const user = await ensureUser();
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', user.id)
    .eq('status', 'pending');

  if (error) throw error;
  return true;
}

export async function getFollowers(userId?: string): Promise<FollowRelationship[]> {
  const targetId = userId ?? (await ensureUser()).id;

  const { data, error } = await supabase
    .from('follows')
    .select(FOLLOW_SELECT_FIELDS)
    .eq('following_id', targetId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return hydrateFollows((data || []) as FollowRecord[], 'follower');
}

export async function getFollowing(userId?: string): Promise<FollowRelationship[]> {
  const targetId = userId ?? (await ensureUser()).id;

  const { data, error } = await supabase
    .from('follows')
    .select(FOLLOW_SELECT_FIELDS)
    .eq('follower_id', targetId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return hydrateFollows((data || []) as FollowRecord[], 'following');
}

export async function getPendingRequests(): Promise<FollowRelationship[]> {
  const user = await ensureUser();

  const { data, error } = await supabase
    .from('follows')
    .select(FOLLOW_SELECT_FIELDS)
    .eq('following_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return hydrateFollows((data || []) as FollowRecord[], 'follower');
}

export async function getFollowCounts(userId?: string): Promise<FollowCounts> {
  const targetId = userId ?? (await ensureUser()).id;

  const [followersResult, followingResult, pendingResult] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', targetId)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('following_id', { count: 'exact', head: true })
      .eq('follower_id', targetId)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', targetId)
      .eq('status', 'pending'),
  ]);

  if (followersResult.error) throw followersResult.error;
  if (followingResult.error) throw followingResult.error;
  if (pendingResult.error) throw pendingResult.error;

  return {
    followers: followersResult.count ?? 0,
    following: followingResult.count ?? 0,
    pending_requests: pendingResult.count ?? 0,
  };
}

export async function getPendingRequestCount(): Promise<number> {
  const counts = await getFollowCounts();
  return counts.pending_requests;
}

export async function getFollowStatus(targetId: string): Promise<FollowStatusSummary> {
  const user = await ensureUser();

  if (user.id === targetId) {
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

  const [outgoingResult, incomingResult, blockedByMeResult, blockedBetweenResult] = await Promise.all([
    supabase
      .from('follows')
      .select('status')
      .eq('follower_id', user.id)
      .eq('following_id', targetId)
      .maybeSingle(),
    supabase
      .from('follows')
      .select('status')
      .eq('follower_id', targetId)
      .eq('following_id', user.id)
      .maybeSingle(),
    supabase
      .from('blocks')
      .select('blocker_id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', targetId)
      .maybeSingle(),
    supabase.rpc('is_blocked_between', { user_a: user.id, user_b: targetId }),
  ]);

  if (outgoingResult.error) throw outgoingResult.error;
  if (incomingResult.error) throw incomingResult.error;
  if (blockedByMeResult.error) throw blockedByMeResult.error;
  if (blockedBetweenResult.error) throw blockedBetweenResult.error;

  const outgoingStatus = (outgoingResult.data?.status ?? null) as FollowStatus | null;
  const incomingStatus = (incomingResult.data?.status ?? null) as FollowStatus | null;
  const blockedByMe = Boolean(blockedByMeResult.data);
  const blockedBetween = Boolean(blockedBetweenResult.data);

  return {
    is_self: false,
    outgoing_status: outgoingStatus,
    incoming_status: incomingStatus,
    follows: outgoingStatus === 'accepted',
    requested: outgoingStatus === 'pending',
    followed_by: incomingStatus === 'accepted',
    blocked_by_me: blockedByMe,
    blocked_between: blockedBetween,
  };
}

export async function blockUser(targetId: string): Promise<BlockRecord> {
  const user = await ensureUser();

  if (user.id === targetId) {
    throw new Error('You cannot block yourself');
  }

  const { data, error } = await supabase
    .from('blocks')
    .upsert(
      {
        blocker_id: user.id,
        blocked_id: targetId,
      },
      { onConflict: 'blocker_id,blocked_id' },
    )
    .select(BLOCK_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data as BlockRecord;
}

export async function unblockUser(targetId: string): Promise<boolean> {
  const user = await ensureUser();

  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', targetId);

  if (error) throw error;
  return true;
}

export async function getBlockedUsers(): Promise<BlockedRelationship[]> {
  const user = await ensureUser();

  const { data, error } = await supabase
    .from('blocks')
    .select(BLOCK_SELECT_FIELDS)
    .eq('blocker_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const blocks = (data || []) as BlockRecord[];
  const profilesById = await getProfilesByUserIds(blocks.map((block) => block.blocked_id));

  return blocks.map((block) => ({
    ...block,
    profile: profilesById.get(block.blocked_id) ?? null,
  }));
}

export async function shareVideo(videoId: string, recipientId: string, message?: string): Promise<VideoShareRecord> {
  const user = await ensureUser();

  if (user.id === recipientId) {
    throw new Error('You cannot share a video with yourself');
  }

  const { data, error } = await supabase
    .from('video_shares')
    .insert({
      video_id: videoId,
      sender_id: user.id,
      recipient_id: recipientId,
      message: trimToNull(message),
    })
    .select(SHARE_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data as VideoShareRecord;
}

export async function getSharedInbox(
  cursor: string | null = null,
  limit = DEFAULT_PAGE_LIMIT,
): Promise<PaginatedResult<VideoShareWithContext>> {
  const user = await ensureUser();
  const pageSize = clampLimit(limit);

  let query = supabase
    .from('video_shares')
    .select(SHARE_SELECT_FIELDS)
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data || []) as VideoShareRecord[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydrateShares(pageRows);

  return {
    items,
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null,
  };
}

export async function getSharedOutbox(
  cursor: string | null = null,
  limit = DEFAULT_PAGE_LIMIT,
): Promise<PaginatedResult<VideoShareWithContext>> {
  const user = await ensureUser();
  const pageSize = clampLimit(limit);

  let query = supabase
    .from('video_shares')
    .select(SHARE_SELECT_FIELDS)
    .eq('sender_id', user.id)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data || []) as VideoShareRecord[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await hydrateShares(pageRows);

  return {
    items,
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null,
  };
}

export async function getUnreadShareCount(): Promise<number> {
  const user = await ensureUser();
  const { count, error } = await supabase
    .from('video_shares')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null);

  if (error) throw error;
  return count ?? 0;
}

export async function markShareRead(shareId: string): Promise<VideoShareRecord | null> {
  const user = await ensureUser();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('video_shares')
    .update({ read_at: nowIso })
    .eq('id', shareId)
    .eq('recipient_id', user.id)
    .is('read_at', null)
    .select(SHARE_SELECT_FIELDS)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return data as VideoShareRecord;
  }

  const { data: existing, error: existingError } = await supabase
    .from('video_shares')
    .select(SHARE_SELECT_FIELDS)
    .eq('id', shareId)
    .eq('recipient_id', user.id)
    .maybeSingle();

  if (existingError) throw existingError;
  return (existing as VideoShareRecord | null) ?? null;
}

export async function replyToShare(shareId: string, message: string): Promise<ShareReplyRecord> {
  const user = await ensureUser();
  const trimmed = message.trim();

  if (!trimmed) {
    throw new Error('Reply cannot be empty');
  }

  const { data, error } = await supabase
    .from('share_replies')
    .insert({
      share_id: shareId,
      user_id: user.id,
      message: trimmed,
    })
    .select(SHARE_REPLY_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data as ShareReplyRecord;
}

export async function getShareThread(shareId: string): Promise<ShareThread> {
  const { data: shareData, error: shareError } = await supabase
    .from('video_shares')
    .select(SHARE_SELECT_FIELDS)
    .eq('id', shareId)
    .maybeSingle();

  if (shareError) throw shareError;

  if (!shareData) {
    return { share: null, replies: [] };
  }

  const share = shareData as VideoShareRecord;

  const { data: repliesData, error: repliesError } = await supabase
    .from('share_replies')
    .select(SHARE_REPLY_SELECT_FIELDS)
    .eq('share_id', shareId)
    .order('created_at', { ascending: true });

  if (repliesError) throw repliesError;

  const replies = (repliesData || []) as ShareReplyRecord[];
  const profileIds = [
    share.sender_id,
    share.recipient_id,
    ...replies.map((reply) => reply.user_id),
  ];

  const [profilesById, videosById] = await Promise.all([
    getProfilesByUserIds(profileIds),
    getVideosByIds([share.video_id]),
  ]);

  return {
    share: {
      ...share,
      sender_profile: profilesById.get(share.sender_id) ?? null,
      recipient_profile: profilesById.get(share.recipient_id) ?? null,
      video: videosById.get(share.video_id) ?? null,
    },
    replies: replies.map((reply) => ({
      ...reply,
      profile: profilesById.get(reply.user_id) ?? null,
    })),
  };
}

export async function getSocialFeed(
  cursor: string | null = null,
  limit = DEFAULT_PAGE_LIMIT,
): Promise<PaginatedResult<VideoWithUrls>> {
  const user = await ensureUser();
  const pageSize = clampLimit(limit);

  const { data: followingRows, error: followingError } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', user.id)
    .eq('status', 'accepted');

  if (followingError) throw followingError;

  const feedUserIds = Array.from(
    new Set([user.id, ...(followingRows || []).map((row) => row.following_id as string)]),
  );

  if (feedUserIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  let query = supabase
    .from('videos')
    .select(VIDEO_SELECT_WITH_COUNTS)
    .in('user_id', feedUserIds)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data || []) as VideoRowWithCounts[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await enrichVideos(pageRows);

  return {
    items,
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null,
  };
}

export async function getUserVideos(
  targetUserId: string,
  cursor: string | null = null,
  limit = DEFAULT_PAGE_LIMIT,
): Promise<PaginatedResult<VideoWithUrls>> {
  const pageSize = clampLimit(limit);

  let query = supabase
    .from('videos')
    .select(VIDEO_SELECT_WITH_COUNTS)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as VideoRowWithCounts[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await enrichVideos(pageRows);

  return {
    items,
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].created_at : null,
  };
}

export async function getMutualFollowProfiles(limit = DEFAULT_PAGE_LIMIT): Promise<ProfileRecord[]> {
  const user = await ensureUser();
  const pageSize = clampLimit(limit);

  const [outgoingResult, incomingResult] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', user.id)
      .eq('status', 'accepted'),
  ]);

  if (outgoingResult.error) throw outgoingResult.error;
  if (incomingResult.error) throw incomingResult.error;

  const incomingIds = new Set((incomingResult.data || []).map((row) => row.follower_id as string));
  const mutualIds = (outgoingResult.data || [])
    .map((row) => row.following_id as string)
    .filter((id) => incomingIds.has(id))
    .slice(0, pageSize);

  const profilesById = await getProfilesByUserIds(mutualIds);
  return mutualIds
    .map((id) => profilesById.get(id) ?? null)
    .filter((profile): profile is ProfileRecord => Boolean(profile));
}
