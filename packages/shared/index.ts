// Types
export type {
  GoalProfile,
  SetType,
  TutSource,
  ExerciseCategory,
  SessionEventType,
  Exercise,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  WorkoutTemplateSet,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionSet,
  WorkoutSessionEvent,
} from './types/workout-session';

export type {
  TelemetryContext,
  EnvironmentContext,
  SessionQuality,
  FrameSample,
  RepFeatures,
  EmittedCue,
  RepEvent,
  SetSummary,
  LabelSource,
  RepLabel,
  TelemetryConsent,
  RetentionClass,
  RetentionPolicy,
  SessionMetricsPayload,
} from './types/telemetry';
export { DEFAULT_RETENTION_POLICY } from './types/telemetry';

// Services
export {
  createError,
  mapToUserMessage,
  logError,
  shouldRetry,
  withErrorHandling,
} from './services/error-handler';
export type { AppError, ErrorContext } from './services/error-handler';

export {
  estimateTut,
  timedSetTut,
  measuredTut,
  parseTempo,
} from './services/tut-estimator';
export type { TutResult, TempoPhases } from './services/tut-estimator';

export { buildVideoMetricsForClip } from './services/video-metrics';
export type { RecordingQuality } from './services/video-metrics';

export {
  selectBestJointPair,
  buildWavePoints,
  computeAsymmetry,
  meanValue,
  clampValue,
  stddev,
  scoreFatigueSignals,
  buildCoachActions,
  scoreFatigueConfidence,
} from './services/workout-insights-helpers';
export type {
  PoseRow,
  JointPair,
  WavePoint,
  FatigueLevel,
  FatigueSignals,
  CoachAction,
  FatigueConfidenceLevel,
  FatigueConfidence,
} from './services/workout-insights-helpers';

// Utils
export {
  logWithTs,
  infoWithTs,
  warnWithTs,
  errorWithTs,
  logger,
  createLogger,
} from './utils/logger';

// Supabase
export { createSupabaseClient } from './supabase/client-factory';
export type { ClientFactoryConfig, SupabaseClient } from './supabase/client-factory';
