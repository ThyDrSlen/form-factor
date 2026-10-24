import { BodyTracker, type BodyPose, type Joint3D } from '@/lib/arkit/ARKitBodyTracker.ios';
import { createRealtimeFormEngineState, processRealtimeAngles } from '@/lib/pose/realtime-form-engine';
import { compareJointAngles } from '@/lib/pose/shadow-metrics';
import { dumbbellCurlDefinition } from '@/lib/workouts/dumbbell-curl';
import { jointsForWorkout } from '@/lib/pose/workout-joint-scope';
import { readFileSync } from 'fs';
import ts from 'typescript';

jest.mock('expo-modules-core', () => ({ requireNativeModule: jest.fn(() => ({
  calculateAngle: (a: Joint3D, b: Joint3D, c: Joint3D) => {
    const ab = [a.x - b.x, a.y - b.y, a.z - b.z];
    const cb = [c.x - b.x, c.y - b.y, c.z - b.z];
    const cosine = ab.reduce((sum, v, i) => sum + v * cb[i], 0) / (Math.hypot(...ab) * Math.hypot(...cb));
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  },
})) }));

function joint(name: string, x: number, y: number, z = 0): Joint3D {
  return { name, x, y, z, isTracked: true };
}

function upperBody(): BodyPose {
  return {
    timestamp: 1, isTracking: true,
    joints: [
      joint('left_upLeg_joint', -0.15, 1), joint('right_upLeg_joint', 0.15, 1),
      joint('left_shoulder_1_joint', -0.2, 1.5), joint('right_shoulder_1_joint', 0.2, 1.5),
      joint('left_forearm_joint', -0.2, 1.2), joint('right_forearm_joint', 0.2, 1.2),
      joint('left_hand_joint', -0.2, 0.9), joint('right_hand_joint', 0.2, 0.9),
      joint('neck_1_joint', 0, 1.6), joint('spine_4_joint', 0, 1.4),
    ],
  };
}

const upperBodyValidity = {
  leftKnee: false, rightKnee: false,
  leftElbow: true, rightElbow: true,
  leftShoulder: true, rightShoulder: true,
  leftHip: true, rightHip: true,
};

const sampleAngles = {
  leftKnee: NaN, rightKnee: NaN,
  leftElbow: 180, rightElbow: 180,
  leftShoulder: 90, rightShoulder: 90,
  leftHip: 180, rightHip: 180,
};

describe('curl tracking with legs outside the camera frame', () => {
  test('calculates curls from arms and hips, without knee or ankle joints', () => {
    const angles = BodyTracker.calculateAllAngles(upperBody(), 'dumbbell_curl');
    expect(angles).not.toBeNull();
    expect(angles!.leftElbow).toBeCloseTo(180);
    expect(angles!.leftHip).toBeCloseTo(180);
    expect(angles!.rightHip).toBeCloseTo(180);
    expect(angles!.leftKnee).toBe(0);
    expect(angles!.rightKnee).toBe(0);
    expect(JSON.parse(JSON.stringify(angles))).toEqual(angles);
  });

  test('never uses inferred or noisy lower legs to measure curl torso stability', () => {
    const pose = upperBody();
    const expected = BodyTracker.calculateAllAngles(pose, 'dumbbell_curl');
    expect(expected).not.toBeNull();
    pose.joints.push(
      joint('left_leg_joint', 99, -99), joint('right_leg_joint', -99, 99),
      { ...joint('left_foot_joint', NaN, Infinity), isTracked: false },
    );
    expect(BodyTracker.calculateAllAngles(pose, 'dumbbell_curl')).toEqual(expected);
  });

  test('still detects torso lean using shoulders relative to the hips', () => {
    const pose = upperBody();
    for (const j of pose.joints) if (!j.name.includes('upLeg')) j.z += 0.5;
    const angles = BodyTracker.calculateAllAngles(pose, 'dumbbell_curl');
    expect(angles).not.toBeNull();
    expect(angles!.leftHip).toBeLessThan(165);
    expect(angles!.rightHip).toBeLessThan(165);
  });

  test.each(['left_upLeg_joint', 'right_upLeg_joint', 'left_hand_joint', 'right_forearm_joint'])(
    'does not fabricate valid curl tracking when %s is untracked', (name) => {
      const pose = upperBody();
      pose.joints.find(j => j.name === name)!.isTracked = false;
      expect(BodyTracker.calculateAllAngles(pose, 'dumbbell_curl')).toBeNull();
    },
  );

  test('rejects invalid upper-body coordinates', () => {
    const pose = upperBody();
    pose.joints[0].x = NaN;
    expect(BodyTracker.calculateAllAngles(pose, 'dumbbell_curl')).toBeNull();
  });

  test('preserves full-body requirements for squats and other workouts', () => {
    expect(BodyTracker.calculateAllAngles(upperBody(), 'squat')).toBeNull();
    expect(BodyTracker.calculateAllAngles(upperBody())).toBeNull();
  });

  test.each([processRealtimeAngles])(
    'quality pipeline %# ignores only irrelevant curl knee angles', (process) => {
      const input = { state: createRealtimeFormEngineState(), angles: sampleAngles,
        valid: upperBodyValidity, timestampSec: 1, workoutId: 'dumbbell_curl' };
      expect(process(input).trackingQuality).toBeCloseTo(1);
      expect(process({ ...input, valid: { ...upperBodyValidity, leftHip: false } }).trackingQuality).toBeLessThan(1);
      expect(process({ ...input, workoutId: 'squat' }).trackingQuality).toBeLessThan(1);
    },
  );

  test('shadow confidence compares arm angles, not knee-based hip flexion against torso inclination', () => {
    const comparison = compareJointAngles(sampleAngles,
      { ...sampleAngles, leftKnee: 0, rightKnee: 45, leftHip: 0, rightHip: 0 },
      { provider: 'mediapipe', modelVersion: 'test', workoutId: 'dumbbell_curl' });
    expect(comparison.meanAbsDelta).toBe(0);
    expect(comparison.comparedJoints).toBe(4);
    expect(comparison.deltaByJoint.leftHip).toBeUndefined();
  });

  test('a complete curl phase cycle works without lower-body joints', () => {
    const pose = upperBody();
    const joints = new Map(pose.joints.map(j => [j.name, j]));
    let phase = dumbbellCurlDefinition.initialPhase;
    const phases: string[] = [];
    for (const elbow of [175, 130, 45, 110, 175]) {
      const radians = elbow * Math.PI / 180;
      for (const side of ['left', 'right']) {
        const wrist = pose.joints.find(j => j.name === `${side}_hand_joint`)!;
        wrist.y = 1.2 + 0.3 * Math.cos(radians);
        wrist.z = 0.3 * Math.sin(radians);
      }
      const angles = BodyTracker.calculateAllAngles(pose, 'dumbbell_curl');
      expect(angles).not.toBeNull();
      const metrics = dumbbellCurlDefinition.calculateMetrics(angles!, joints);
      expect(metrics.armsTracked).toBe(true);
      phase = dumbbellCurlDefinition.getNextPhase(phase, angles!, metrics);
      phases.push(phase);
    }
    expect(phases).toEqual(['bottom', 'curling', 'top', 'lowering', 'bottom']);
  });

  test.each([true, false])('Scan accepts arms and hips without knees (neck visible: %s)', (neckVisible) => {
    const source = ts.createSourceFile('scan.tsx', readFileSync('app/(tabs)/scan-arkit.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statements: ts.Statement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isTryStatement(node) && node.tryBlock.statements[0]?.getText(source).includes('BodyTracker.calculateAllAngles')) {
        for (const statement of node.tryBlock.statements) {
          statements.push(statement);
          if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(source) === 'valid')) break;
        }
      } else ts.forEachChild(node, visit);
    };
    visit(source);
    expect(statements.length).toBeGreaterThan(1);
    const js = ts.transpileModule(`${statements.map(s => s.getText(source)).join('\n')}\nreturn { angles, valid };`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // Execute only the trusted repository frame slice, never external input.
    const pose = upperBody();
    if (!neckVisible) pose.joints = pose.joints.filter(j => !/neck|spine/.test(j.name));
    const result = new Function('BodyTracker', 'pose', 'detectionMode', 'trackingDebugEnabledRef', js)(BodyTracker, pose, 'dumbbell_curl', { current: false });
    expect(result.angles).not.toBeNull();
    expect(result.valid).toEqual(upperBodyValidity);
  });

  test('framing and occlusion exclude lower legs, retaining hips for curls only', () => {
    const joints = [...upperBody().joints, joint('left_leg_joint', 0, 2), joint('right_ankle', 0, 3), joint('left_toes_joint', 0, 4)];
    expect(jointsForWorkout(joints, 'dumbbell_curl')).toEqual(upperBody().joints);
    expect(jointsForWorkout(joints, 'squat')).toEqual(joints);
    const source = readFileSync('app/(tabs)/scan-arkit.tsx', 'utf8');
    expect(source.includes('jointsForWorkout(pose2D.joints, detectionMode)')).toBe(true);
  });
});
