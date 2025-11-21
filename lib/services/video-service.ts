import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Buffer } from 'buffer';
import { supabase } from '@/lib/supabase';

const VIDEO_BUCKET = 'videos';
const THUMBNAIL_BUCKET = 'video-thumbnails';
const DEFAULT_SIGNED_URL_SECONDS = 60 * 60 * 24; // 24 hours
const DEFAULT_MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250MB

export type VideoRecord = {
  id: string;
  user_id: string;
  path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  exercise: string | null;
  metrics?: Record<string, any> | null;
  created_at: string;
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

async function ensureUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not signed in');
  return data.user;
}

function base64ToUint8Array(base64: string) {
  return Buffer.from(base64, 'base64');
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
  thumbnailTimeMs?: number;
  usePrivateThumbnail?: boolean;
  metrics?: Record<string, any>;
}) {
  const {
    fileUri,
    durationSeconds,
    exercise,
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    thumbnailTimeMs = 500,
    usePrivateThumbnail = false,
    metrics,
  } = opts;

  const user = await ensureUser();
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error('File does not exist at provided URI');
  }
  if (fileInfo.size && fileInfo.size > maxUploadBytes) {
    throw new Error(`File is too large. Max ${Math.round(maxUploadBytes / (1024 * 1024))}MB allowed.`);
  }

  const videoId = Crypto.randomUUID();
  const videoPath = `${user.id}/${videoId}.mp4`;

  // Upload video
  const videoBase64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
  const videoBytes = base64ToUint8Array(videoBase64);
  const { error: uploadError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(videoPath, videoBytes, { contentType: 'video/mp4', upsert: false });
  if (uploadError) {
    throw uploadError;
  }

  // Thumbnail (best-effort)
  let thumbnailPath: string | null = null;
  try {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(fileUri, { time: thumbnailTimeMs });
    const thumbBase64 = await FileSystem.readAsStringAsync(thumbUri, { encoding: FileSystem.EncodingType.Base64 });
    const thumbBytes = base64ToUint8Array(thumbBase64);
    thumbnailPath = `${user.id}/${videoId}.jpg`;
    const targetBucket = usePrivateThumbnail ? VIDEO_BUCKET : THUMBNAIL_BUCKET;
    const { error: thumbError } = await supabase.storage
      .from(targetBucket)
      .upload(thumbnailPath, thumbBytes, { contentType: 'image/jpeg', upsert: false });
    if (thumbError) {
      console.warn('[video-service] Failed to upload thumbnail', thumbError);
      thumbnailPath = null;
    }
  } catch (error) {
    console.warn('[video-service] Thumbnail generation failed', error);
    thumbnailPath = null;
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

export async function listVideos(limit = 20) {
  const { data, error } = await supabase
    .from('videos')
    .select('id, user_id, path, thumbnail_path, duration_seconds, exercise, metrics, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const withUrls: VideoWithUrls[] = await Promise.all(
    (data || []).map(async (video) => {
      const signedUrl = await getSignedVideoUrl(video.path);
      const thumbnailUrl = video.thumbnail_path
        ? await getSignedThumbnailUrl(video.thumbnail_path)
        : null;
      return { ...(video as VideoRecord), signedUrl, thumbnailUrl };
    })
  );

  return withUrls;
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
