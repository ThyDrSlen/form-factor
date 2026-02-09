import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';
import { warnWithTs } from '@/lib/logger';

const VIDEO_BUCKET = 'videos';
const THUMBNAIL_BUCKET = 'video-thumbnails';
const DEFAULT_SIGNED_URL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250MB
const DEFAULT_MAX_THUMBNAIL_BYTES = 80 * 1024 * 1024; // 80MB

export type VideoRecord = {
  id: string;
  user_id: string;
  path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  exercise: string | null;
  metrics?: Record<string, any> | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  like_count?: number | null;
  comment_count?: number | null;
};

export type CommentRecord = {
  id: string;
  video_id: string;
  user_id: string;
  comment: string;
  created_at: string;
};

export type VideoWithUrls = VideoRecord & {
  signedUrl?: string;
  thumbnailUrl?: string | null;
};

type CountAggregateRow = { count: number | null };

type ProfileSummary = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type VideoRowWithCounts = {
  id: string;
  user_id: string;
  path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  exercise: string | null;
  metrics: Record<string, any> | null;
  created_at: string;
  video_likes?: CountAggregateRow[] | null;
  video_comments?: CountAggregateRow[] | null;
};

async function ensureUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not signed in');
  return data.user;
}

function getSupabaseUrl() {
  const constantsAny = Constants as any;
  const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || constantsAny.default?.expoConfig?.extra?.supabaseUrl;
  if (!supabaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL. Check your environment config.');
  }
  return supabaseUrl;
}

function getSupabaseAnonKey() {
  const constantsAny = Constants as any;
  const supabaseAnonKey =
    Constants.expoConfig?.extra?.supabaseAnonKey || constantsAny.default?.expoConfig?.extra?.supabaseAnonKey;
  if (!supabaseAnonKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. Check your environment config.');
  }
  return supabaseAnonKey;
}

function getFileExtension(uri: string) {
  const cleanUri = uri.split('?')[0];
  const match = cleanUri.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function encodeStoragePath(path: string) {
  return encodeURIComponent(path).replace(/%2F/g, '/');
}

async function uploadFileToStorage(opts: {
  bucket: string;
  path: string;
  fileUri: string;
  contentType: string;
}) {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  const encodedPath = encodeStoragePath(opts.path);
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/storage/v1/object/${opts.bucket}/${encodedPath}`;

  const result = await FileSystem.uploadAsync(url, opts.fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': opts.contentType,
      'x-upsert': 'false',
    },
  });

  if (result.status < 200 || result.status >= 300) {
    const bodySnippet = result.body ? `: ${result.body.slice(0, 200)}` : '';
    throw new Error(`Upload failed (${result.status})${bodySnippet}`);
  }
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return 20;
  return Math.min(50, Math.max(1, Math.floor(limit)));
}

function extractAggregateCount(rows: CountAggregateRow[] | null | undefined) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const value = rows[0]?.count;
  return typeof value === 'number' ? value : null;
}

async function getProfilesByUserIds(userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, ProfileSummary>();

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, avatar_url')
    .in('user_id', ids);

  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.user_id, profile as ProfileSummary]));
}

async function getSocialFeedUserIds(currentUserId: string) {
  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', currentUserId)
    .eq('status', 'accepted');

  if (error) throw error;

  return Array.from(new Set([currentUserId, ...(data || []).map((row) => row.following_id as string)]));
}

async function safeGetSignedVideoUrl(path: string, videoId: string, expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS) {
  try {
    return await getSignedVideoUrl(path, expiresInSeconds);
  } catch (error) {
    if (__DEV__) {
      warnWithTs(`[video-service] Failed to sign video URL for ${videoId}`, error);
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
    return await getSignedThumbnailUrl(path, expiresInSeconds);
  } catch (error) {
    if (__DEV__) {
      warnWithTs(`[video-service] Failed to sign thumbnail URL for ${videoId}`, error);
    }
    return null;
  }
}

async function enrichVideoRows(rows: VideoRowWithCounts[]): Promise<VideoWithUrls[]> {
  if (rows.length === 0) return [];

  const profilesById = await getProfilesByUserIds(rows.map((row) => row.user_id));

  return Promise.all(
    rows.map(async (row) => {
      const profile = profilesById.get(row.user_id) ?? null;
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
        like_count: extractAggregateCount(row.video_likes),
        comment_count: extractAggregateCount(row.video_comments),
        username: profile?.username ?? null,
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        signedUrl,
        thumbnailUrl,
      };
    }),
  );
}

export async function getSignedVideoUrl(path: string, expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS) {
  const { data, error } = await supabase
    .storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw error;
  return data?.signedUrl;
}

export async function getSignedThumbnailUrl(path: string | null, expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS) {
  if (!path) return null;
  const { data, error } = await supabase
    .storage
    .from(THUMBNAIL_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl;
}

export async function uploadWorkoutVideo(opts: {
  fileUri: string;
  durationSeconds?: number;
  exercise?: string;
  maxUploadBytes?: number;
  maxThumbnailBytes?: number;
  thumbnailTimeMs?: number;
  usePrivateThumbnail?: boolean;
  metrics?: Record<string, any>;
}) {
  const {
    fileUri,
    durationSeconds,
    exercise,
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    maxThumbnailBytes = DEFAULT_MAX_THUMBNAIL_BYTES,
    thumbnailTimeMs = 500,
    usePrivateThumbnail = false,
    metrics,
  } = opts;

  // Validate env before auth/upload calls so failures are explicit and actionable.
  getSupabaseUrl();
  getSupabaseAnonKey();

  const user = await ensureUser();
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error('File does not exist at provided URI');
  }
  if (fileInfo.size && fileInfo.size > maxUploadBytes) {
    throw new Error(`File is too large. Max ${Math.round(maxUploadBytes / (1024 * 1024))}MB allowed.`);
  }

  const videoId = Crypto.randomUUID();
  const extension = getFileExtension(fileUri);
  const isMov = extension === 'mov';
  const isMp4 = extension === 'mp4' || extension === 'm4v';
  const videoExtension = isMov ? 'mov' : isMp4 ? 'mp4' : 'mp4';
  const videoContentType = isMov ? 'video/quicktime' : 'video/mp4';
  const videoPath = `${user.id}/${videoId}.${videoExtension}`;

  // Upload video
  await uploadFileToStorage({
    bucket: VIDEO_BUCKET,
    path: videoPath,
    fileUri,
    contentType: videoContentType,
  });

  // Thumbnail (best-effort). Skip for very large files to reduce memory pressure.
  let thumbnailPath: string | null = null;
  if (!fileInfo.size || fileInfo.size <= maxThumbnailBytes) {
    try {
      const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(fileUri, { time: thumbnailTimeMs });
      thumbnailPath = `${user.id}/${videoId}.jpg`;
      const targetBucket = usePrivateThumbnail ? VIDEO_BUCKET : THUMBNAIL_BUCKET;
      await uploadFileToStorage({
        bucket: targetBucket,
        path: thumbnailPath,
        fileUri: thumbUri,
        contentType: 'image/jpeg',
      });
    } catch (error) {
      warnWithTs('[video-service] Thumbnail generation failed', error);
      thumbnailPath = null;
    }
  } else {
    warnWithTs('[video-service] Skipping thumbnail for large video');
  }

  // Persist video record; reuse generated id for join paths
  const { data, error: insertError } = await supabase
    .from('videos')
    .insert({
      id: videoId,
      user_id: user.id,
      path: videoPath,
      thumbnail_path: thumbnailPath,
      duration_seconds: durationSeconds ?? null,
      exercise: exercise ?? null,
      metrics: metrics ?? null,
    })
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return data as VideoRecord;
}

export async function listVideos(limit = 20, opts?: { onlyMine?: boolean; socialFeed?: boolean }) {
  const socialFeed = opts?.socialFeed ?? false;
  const onlyMine = opts?.onlyMine ?? !socialFeed;
  const boundedLimit = clampLimit(limit);
  const userId = onlyMine || socialFeed ? (await ensureUser()).id : null;
  let query = supabase
    .from('videos')
    .select(
      'id, user_id, path, thumbnail_path, duration_seconds, exercise, metrics, created_at, video_likes(count), video_comments(count)',
    )
    .order('created_at', { ascending: false })
    .limit(boundedLimit);

  if (socialFeed && userId) {
    const socialUserIds = await getSocialFeedUserIds(userId);
    query = query.in('user_id', socialUserIds);
  }

  if (onlyMine && userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return enrichVideoRows((data || []) as VideoRowWithCounts[]);
}

export async function getVideoById(videoId: string) {
  const { data, error } = await supabase
    .from('videos')
    .select(
      'id, user_id, path, thumbnail_path, duration_seconds, exercise, metrics, created_at, video_likes(count), video_comments(count)',
    )
    .eq('id', videoId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Video not found');

  const [video] = await enrichVideoRows([data as VideoRowWithCounts]);
  if (!video) throw new Error('Video not found');
  return video;
}

export async function fetchVideoComments(videoId: string) {
  const { data, error } = await supabase
    .from('video_comments')
    .select('id, video_id, user_id, comment, created_at')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data as CommentRecord[];
}

export async function addVideoComment(videoId: string, comment: string) {
  const user = await ensureUser();
  const trimmed = comment.trim();
  if (!trimmed) throw new Error('Comment cannot be empty');

  const { data, error } = await supabase
    .from('video_comments')
    .insert({
      video_id: videoId,
      user_id: user.id,
      comment: trimmed,
    })
    .select()
    .single();

  if (error) throw error;
  return data as CommentRecord;
}

export function subscribeToVideoComments(
  videoId: string,
  onInsert: (comment: CommentRecord) => void
) {
  const channel = supabase
    .channel(`video-comments-${videoId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'video_comments', filter: `video_id=eq.${videoId}` },
      (payload) => {
        onInsert(payload.new as CommentRecord);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function toggleVideoLike(videoId: string) {
  const user = await ensureUser();
  const { data, error } = await supabase
    .from('video_likes')
    .select('video_id')
    .eq('video_id', videoId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    const { error: deleteError } = await supabase
      .from('video_likes')
      .delete()
      .eq('video_id', videoId)
      .eq('user_id', user.id);
    if (deleteError) throw deleteError;
    return { liked: false };
  }

  const { error: insertError } = await supabase
    .from('video_likes')
    .insert({ video_id: videoId, user_id: user.id });

  if (insertError) throw insertError;
  return { liked: true };
}

export async function recordVideoView(videoId: string) {
  const user = await ensureUser().catch(() => null);
  const payload: { video_id: string; user_id?: string } = { video_id: videoId };
  if (user?.id) {
    payload.user_id = user.id;
  }
  const { error } = await supabase.from('video_views').insert(payload);
  if (error) throw error;
  return true;
}

export async function deleteVideo(videoId: string) {
  const user = await ensureUser();
  const { data, error } = await supabase
    .from('videos')
    .select('id, user_id, path, thumbnail_path')
    .eq('id', videoId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('Video not found');
  }
  if (data.user_id !== user.id) {
    throw new Error('You can only delete your own videos');
  }

  const { error: deleteError } = await supabase.from('videos').delete().eq('id', videoId);
  if (deleteError) throw deleteError;

  const removeFromBucket = async (bucket: string, path?: string | null) => {
    if (!path) return;
    const { error: storageError } = await supabase.storage.from(bucket).remove([path]);
    if (storageError) {
      warnWithTs(`[video-service] Failed to remove ${path} from ${bucket}`, storageError);
    }
  };

  await removeFromBucket(VIDEO_BUCKET, data.path);
  if (data.thumbnail_path) {
    await removeFromBucket(THUMBNAIL_BUCKET, data.thumbnail_path);
    await removeFromBucket(VIDEO_BUCKET, data.thumbnail_path);
  }

  return true;
}
