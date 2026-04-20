/**
 * Unit tests for drill-tracker service.
 */

const mockLogCueEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/services/cue-logger', () => ({
  logCueEvent: (...args: unknown[]) => mockLogCueEvent(...args),
}));

jest.mock('@/lib/logger', () => ({
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
  logWithTs: jest.fn(),
}));

import { drillTracker, logDrillEvent } from '@/lib/services/drill-tracker';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('drill-tracker', () => {
  it('logDrillEvent forwards to the cue-logger with the expected shape', async () => {
    await logDrillEvent({
      sessionId: 'sess-1',
      exerciseId: 'pullup',
      faultId: 'shoulder_elevation',
      drillId: 'pullup-scap-pull',
      action: 'viewed',
      repCount: 3,
    });
    expect(mockLogCueEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        cue: 'drill:pullup-scap-pull',
        mode: 'pullup',
        phase: 'shoulder_elevation',
        reason: 'drill_viewed',
        repCount: 3,
      }),
    );
  });

  it('drillTracker.markStarted encodes the lifecycle action', async () => {
    await drillTracker.markStarted({
      sessionId: 'sess-1',
      exerciseId: 'squat',
      faultId: 'shallow_depth',
      drillId: 'squat-goblet-ankle-mob',
    });
    expect(mockLogCueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'drill_started' }),
    );
  });

  it('swallows downstream errors without throwing', async () => {
    mockLogCueEvent.mockRejectedValueOnce(new Error('network down'));
    await expect(
      drillTracker.markCompleted({
        sessionId: 'sess-1',
        exerciseId: 'bench',
        faultId: 'elbow_flare',
        drillId: 'bench-close-grip',
      }),
    ).resolves.toBeUndefined();
  });

  it('covers all four actions on the shorthand', async () => {
    const base = {
      sessionId: 'sess-1',
      exerciseId: 'pushup',
      faultId: 'hip_sag',
      drillId: 'pushup-plank-hold',
    };
    await drillTracker.markViewed(base);
    await drillTracker.markStarted(base);
    await drillTracker.markCompleted(base);
    await drillTracker.markDismissed(base);
    const reasons = mockLogCueEvent.mock.calls.map((c) => (c[0] as { reason: string }).reason);
    expect(reasons).toEqual([
      'drill_viewed',
      'drill_started',
      'drill_completed',
      'drill_dismissed',
    ]);
  });
});
