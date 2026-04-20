/**
 * cue-logger unit tests — structured payload shape.
 *
 * Issue #430 Gap 4 — file previously had no unit test coverage.
 * Exercises `logCueEvent` + `upsertSessionMetrics` payload shape
 * (experiment/variant/version enrichment, throttled/dropped defaults,
 * error swallowing).
 */

// ---------------------------------------------------------------------------
// Mock supabase chain: `from(table).insert/upsert(payload)` returns a promise.
// ---------------------------------------------------------------------------
const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
const upsertCalls: Array<{ table: string; payload: Record<string, unknown>; options?: Record<string, unknown> }> = [];

const mockFrom = jest.fn((table: string) => ({
  insert: jest.fn(async (payload: Record<string, unknown>) => {
    insertCalls.push({ table, payload });
    return { data: null, error: null };
  }),
  upsert: jest.fn(async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
    upsertCalls.push({ table, payload, options });
    return { data: null, error: null };
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

jest.mock('@/lib/auth-utils', () => ({
  ensureUserId: jest.fn(async () => 'user-123'),
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'uuid-fixture-abc'),
}));

jest.mock('@/lib/services/telemetry-context', () => ({
  getTelemetryContext: () => ({
    modelVersion: 'arkit-angles@1.0.0',
    cueConfigVersion: 'v1',
    exerciseConfigVersion: 'v1',
    experimentId: 'exp-42',
    variant: 'B',
  }),
  getEnvironmentContext: () => ({
    deviceModel: 'iPhone 15 Pro',
    osVersion: '17.4',
    cameraAngleClass: 'front',
    distanceBucket: 'medium',
    lightingBucket: 'bright',
    mirrorPresent: false,
  }),
  getSessionQuality: () => ({
    poseLostCount: 2,
    lowConfidenceFrames: 5,
    trackingResetCount: 0,
    userAbortedEarly: false,
    cuesDisabledMidSession: false,
  }),
  getRetentionClass: () => 'medium',
}));

import {
  generateSessionId,
  logCueEvent,
  upsertSessionMetrics,
  startSession,
  endSession,
} from '@/lib/services/cue-logger';

describe('cue-logger', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    upsertCalls.length = 0;
    mockFrom.mockClear();
  });

  describe('generateSessionId', () => {
    test('returns the expo-crypto UUID', () => {
      expect(generateSessionId()).toBe('uuid-fixture-abc');
    });
  });

  describe('logCueEvent', () => {
    test('structured payload contains all mandatory fields + experiment enrichment', async () => {
      await logCueEvent({
        sessionId: 'sess-1',
        cue: 'Chin past the bar.',
        mode: 'speech',
        phase: 'concentric',
        repCount: 3,
        reason: 'threshold_exceeded',
        latencyMs: 120,
      });

      expect(insertCalls).toHaveLength(1);
      const row = insertCalls[0];
      expect(row.table).toBe('cue_events');
      expect(row.payload).toMatchObject({
        user_id: 'user-123',
        session_id: 'sess-1',
        cue: 'Chin past the bar.',
        mode: 'speech',
        phase: 'concentric',
        rep_count: 3,
        reason: 'threshold_exceeded',
        latency_ms: 120,
        experiment_id: 'exp-42',
        variant: 'B',
        cue_config_version: 'v1',
      });
    });

    test('throttled/dropped default to false when not provided', async () => {
      await logCueEvent({ sessionId: 'sess-1', cue: 'Hi' });
      expect(insertCalls[0].payload.throttled).toBe(false);
      expect(insertCalls[0].payload.dropped).toBe(false);
    });

    test('throttled/dropped preserve explicit true', async () => {
      await logCueEvent({ sessionId: 'sess-1', cue: 'Hi', throttled: true, dropped: true });
      expect(insertCalls[0].payload.throttled).toBe(true);
      expect(insertCalls[0].payload.dropped).toBe(true);
    });

    test('swallows supabase errors (does not throw)', async () => {
      mockFrom.mockImplementationOnce(
        () =>
          ({
            insert: jest.fn(async (_payload: Record<string, unknown>) => {
              throw new Error('rls denied');
            }),
            upsert: jest.fn(async (_payload: Record<string, unknown>) => ({
              data: null,
              error: null,
            })),
          }) as unknown as ReturnType<typeof mockFrom>,
      );
      await expect(logCueEvent({ sessionId: 's', cue: 'c' })).resolves.toBeUndefined();
    });
  });

  describe('upsertSessionMetrics', () => {
    test('uses session_id onConflict + enriches from telemetry/environment/quality contexts', async () => {
      await upsertSessionMetrics({
        sessionId: 'sess-42',
        startAt: '2026-04-16T00:00:00Z',
        avgFps: 30,
        cuesTotal: 10,
        cuesSpoken: 8,
        cuesDroppedRepeat: 1,
        cuesDroppedDisabled: 1,
      });

      expect(upsertCalls).toHaveLength(1);
      const row = upsertCalls[0];
      expect(row.table).toBe('session_metrics');
      expect(row.options).toEqual({ onConflict: 'session_id' });
      expect(row.payload).toMatchObject({
        user_id: 'user-123',
        session_id: 'sess-42',
        start_at: '2026-04-16T00:00:00Z',
        avg_fps: 30,
        cues_total: 10,
        cues_spoken: 8,
        cues_dropped_repeat: 1,
        cues_dropped_disabled: 1,
        model_version: 'arkit-angles@1.0.0',
        cue_config_version: 'v1',
        exercise_config_version: 'v1',
        experiment_id: 'exp-42',
        variant: 'B',
        device_model: 'iPhone 15 Pro',
        os_version: '17.4',
        camera_angle_class: 'front',
        distance_bucket: 'medium',
        lighting_bucket: 'bright',
        mirror_present: false,
        pose_lost_count: 2,
        low_confidence_frames: 5,
        tracking_reset_count: 0,
        user_aborted_early: false,
        cues_disabled_mid_session: false,
        retention_class: 'medium',
      });
    });

    test('explicit fields override context defaults', async () => {
      await upsertSessionMetrics({
        sessionId: 's',
        modelVersion: 'override@9.9.9',
        deviceModel: 'iPad Pro',
        poseLostCount: 99,
      });
      expect(upsertCalls[0].payload.model_version).toBe('override@9.9.9');
      expect(upsertCalls[0].payload.device_model).toBe('iPad Pro');
      expect(upsertCalls[0].payload.pose_lost_count).toBe(99);
    });
  });

  describe('startSession / endSession', () => {
    test('startSession generates a uuid and upserts start_at', async () => {
      const id = await startSession();
      expect(id).toBe('uuid-fixture-abc');
      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0].payload.session_id).toBe('uuid-fixture-abc');
      expect(typeof upsertCalls[0].payload.start_at).toBe('string');
    });

    test('endSession upserts end_at + carries finalMetrics', async () => {
      await endSession('sess-final', { avgFps: 27.5 });
      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0].payload.session_id).toBe('sess-final');
      expect(upsertCalls[0].payload.avg_fps).toBe(27.5);
      expect(typeof upsertCalls[0].payload.end_at).toBe('string');
    });
  });
});
