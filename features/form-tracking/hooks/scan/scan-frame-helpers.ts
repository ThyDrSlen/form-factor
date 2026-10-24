import { BodyTracker, type BodyPose, type JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { PullupScoringInput } from '@/lib/tracking-quality';
import type { DetectionMode } from '@/lib/workouts';
import type { BaselineDebugMetrics } from './scan-constants';

/**
 * Looks up the ARKit joints that feed angle validity for one frame. When
 * `debug` is set, also records every candidate joint per lookup name.
 */
export function resolveFrameJoints(
  pose: BodyPose,
  detectionMode: DetectionMode,
  angles: JointAngles | null,
  debug: boolean,
) {
  const jointLookupDebug: Record<string, unknown> = {};
  const get = (n: string) => {
    const selected = BodyTracker.findJoint(pose, n);
    if (debug) {
      const normalized = n.toLowerCase();
      const candidates = pose.joints
        .filter((joint) => joint.name.toLowerCase().includes(normalized))
        .map((joint) => ({
          name: joint.name,
          isTracked: joint.isTracked,
          x: Number(joint.x.toFixed(4)),
          y: Number(joint.y.toFixed(4)),
        }));
      jointLookupDebug[n] = {
        candidates,
        selected: selected
          ? {
              name: selected.name,
              isTracked: selected.isTracked,
              x: Number(selected.x.toFixed(4)),
              y: Number(selected.y.toFixed(4)),
            }
          : null,
      };
    }
    return selected;
  };
  const lh = get('left_upLeg');
  const lk = get('left_leg');
  const la = get('left_foot');
  const rh = get('right_upLeg');
  const rk = get('right_leg');
  const ra = get('right_foot');
  const ls = get('left_shoulder');
  const le = get('left_forearm');
  const lw = get('left_hand');
  const rs = get('right_shoulder');
  const re = get('right_forearm');
  const rw = get('right_hand');
  const spine = get('spine_4');
  const neck = get('neck');
  const valid = {
    leftKnee: detectionMode !== 'dumbbell_curl' && !!(lh?.isTracked && lk?.isTracked && la?.isTracked),
    rightKnee: detectionMode !== 'dumbbell_curl' && !!(rh?.isTracked && rk?.isTracked && ra?.isTracked),
    leftElbow: !!(ls?.isTracked && le?.isTracked && lw?.isTracked),
    rightElbow: !!(rs?.isTracked && re?.isTracked && rw?.isTracked),
    leftHip: detectionMode === 'dumbbell_curl'
      ? !!angles && Number.isFinite(angles.leftHip)
      : !!(spine?.isTracked && lh?.isTracked && lk?.isTracked),
    rightHip: detectionMode === 'dumbbell_curl'
      ? !!angles && Number.isFinite(angles.rightHip)
      : !!(spine?.isTracked && rh?.isTracked && rk?.isTracked),
    leftShoulder: detectionMode === 'dumbbell_curl'
      ? !!angles && Number.isFinite(angles.leftShoulder)
      : !!(neck?.isTracked && ls?.isTracked && le?.isTracked),
    rightShoulder: detectionMode === 'dumbbell_curl'
      ? !!angles && Number.isFinite(angles.rightShoulder)
      : !!(neck?.isTracked && rs?.isTracked && re?.isTracked),
  } as const;
  const confidence = {
    neck: neck?.isTracked ?? false,
    leftShoulder: ls?.isTracked ?? false,
    rightShoulder: rs?.isTracked ?? false,
    leftForearm: le?.isTracked ?? false,
    rightForearm: re?.isTracked ?? false,
    leftHand: lw?.isTracked ?? false,
    rightHand: rw?.isTracked ?? false,
  };
  return { valid, jointLookupDebug, confidence };
}

/** Live (in-flight) pull-up scoring uses the current frame for every rep extreme. */
export function liveRepAngles(next: JointAngles): PullupScoringInput['repAngles'] {
  const arms = () => ({
    leftElbow: next.leftElbow,
    rightElbow: next.rightElbow,
    leftShoulder: next.leftShoulder,
    rightShoulder: next.rightShoulder,
  });
  return { start: arms(), end: arms(), min: arms(), max: arms() };
}

export function recordFrameLatency(metrics: BaselineDebugMetrics, elapsedMs: number): void {
  metrics.frameLatencyCount += 1;
  metrics.frameLatencyTotalMs += elapsedMs;
  if (elapsedMs < 4) {
    metrics.latencyBuckets.lt4 += 1;
  } else if (elapsedMs < 8) {
    metrics.latencyBuckets.lt8 += 1;
  } else if (elapsedMs < 16) {
    metrics.latencyBuckets.lt16 += 1;
  } else {
    metrics.latencyBuckets.gte16 += 1;
  }
}
