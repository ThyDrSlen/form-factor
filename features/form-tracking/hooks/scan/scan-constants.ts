import type { DetectionMode } from '@/lib/workouts';
import type { RecordingQuality } from '@/lib/services/video-metrics';
import type { PullupFixtureFrame } from '@/lib/debug/pullup-fixture-corpus';
import cameraFacingFixture from '@/tests/fixtures/pullup-tracking/camera-facing.json';
import backTurnedFixture from '@/tests/fixtures/pullup-tracking/back-turned.json';
import occlusionBriefFixture from '@/tests/fixtures/pullup-tracking/occlusion-brief.json';
import occlusionLongFixture from '@/tests/fixtures/pullup-tracking/occlusion-long.json';
import bounceNoiseFixture from '@/tests/fixtures/pullup-tracking/bounce-noise.json';
import { Ionicons } from '@expo/vector-icons';
import { View, Platform } from 'react-native';

// Phase and detection mode types are now imported from lib/workouts
export type BaseUploadMetrics = Record<string, unknown> & {
  mode: DetectionMode;
  reps: number;
};

export type ClipMetaMetrics = {
  avgFqi: number | null;
  formScore: number | null;
  sessionId: string;
  recordingQuality: RecordingQuality;
  recordingStartAt: string;
  recordingEndAt: string;
  recordingStartFrameTimestamp: number | null;
  recordingEndFrameTimestamp: number | null;
};

export type ClipUploadMetrics = BaseUploadMetrics & ClipMetaMetrics;

export type RecordedPreview = {
  uri: string;
  exercise: string;
  metrics: ClipUploadMetrics;
  sizeBytes: number | null;
  savedToLibrary: boolean;
};

// Thresholds are now imported from workout definitions (PULLUP_THRESHOLDS, PUSHUP_THRESHOLDS)

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

// Upper bound for the 2D pose smoothing cache. ARKit exposes ~20 joints;
// we allow modest alias headroom before LRU-evicting the oldest entry.
export const POSE2D_CACHE_MAX_ENTRIES = 30;

// Minimum wall-clock interval between FPS stat publishes. Frames can arrive
// at up to 60Hz; publishing state + debug logs on every frame wastes both
// render work and log bandwidth when only the smoothed average is useful.
export const FPS_PUBLISH_INTERVAL_MS = 500;

export const WATCH_MIRROR_INTERVAL_MS = 100;

export const WATCH_MIRROR_AR_QUALITY = 0.25;

export const WATCH_MIRROR_MAX_WIDTH = 320;

export const MEDIAPIPE_SHADOW_POLL_INTERVAL_MS = 100;

export const MEDIAPIPE_MAX_TIMESTAMP_SKEW_SEC = 0.4;

export const PARTIAL_TRACKING_BADGE_MIN_VISIBLE_MS = 900;

export const PARTIAL_TRACKING_BADGE_HIDE_DELAY_MS = 350;

export const FIXTURE_PLAYBACK_DEFAULT = 'camera-facing';

export const FIXTURE_PLAYBACK_TRACES: Record<string, PullupFixtureFrame[]> = {
  'camera-facing': cameraFacingFixture as PullupFixtureFrame[],
  'back-turned': backTurnedFixture as PullupFixtureFrame[],
  'occlusion-brief': occlusionBriefFixture as PullupFixtureFrame[],
  'occlusion-long': occlusionLongFixture as PullupFixtureFrame[],
  'bounce-noise': bounceNoiseFixture as PullupFixtureFrame[],
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const MEDIAPIPE_LITE_MODEL_ASSET = require('../../../../assets/models/pose_landmarker_lite.task');

export const QUALITY_STORAGE_KEY = 'ff.recordingQuality';

export const QUALITY_LABELS: Record<RecordingQuality, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
};

export const toIoniconName = (name: string | undefined): keyof typeof Ionicons.glyphMap => {
  if (name && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, name)) {
    return name as keyof typeof Ionicons.glyphMap;
  }
  return 'barbell-outline';
};

export type BaselineLatencyBucket = 'lt4' | 'lt8' | 'lt16' | 'gte16';

export type BaselineDebugMetrics = {
  cueFlipCount: number;
  cueSamples: number;
  lastCue: string | null;
  latencyBuckets: Record<BaselineLatencyBucket, number>;
  frameLatencyTotalMs: number;
  frameLatencyCount: number;
};

export const createBaselineDebugMetrics = (): BaselineDebugMetrics => ({
  cueFlipCount: 0,
  cueSamples: 0,
  lastCue: null,
  latencyBuckets: {
    lt4: 0,
    lt8: 0,
    lt16: 0,
    gte16: 0,
  },
  frameLatencyTotalMs: 0,
  frameLatencyCount: 0,
});

export const nowMs = (): number => {
  const perfNow = globalThis.performance?.now;
  if (typeof perfNow === 'function') {
    return perfNow.call(globalThis.performance);
  }
  return Date.now();
};

// Metrics types are now imported from workout definitions (PullUpMetrics, PushUpMetrics)

export let ARKitView: any = View;

if (Platform.OS === 'ios') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ARKitView = require('@/lib/arkit/ARKitBodyView').default;
}

export const formatBytes = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};

export const getMetricValue = (source: Record<string, unknown> | null | undefined, key: string): number | null => {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const formatMetricValue = (format: 'deg' | 'percent', value: number | null): string => {
  if (value === null) return '--';
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  return `${value.toFixed(1)}°`;
};

export const formatDuration = (startIso: string | null | undefined, endIso: string | null | undefined): string => {
  if (!startIso || !endIso) return '--';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
};
