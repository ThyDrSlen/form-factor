import React, { forwardRef, memo, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Svg, Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import type { BodyPose2D, Joint2D } from '@/lib/arkit/ARKitBodyTracker';
import type { DetectionMode } from '@/lib/workouts';
import type { PullupScoringResult } from '@/lib/tracking-quality/scoring';
import { usePoseOverlay } from '@/features/form-tracking/hooks/use-pose-overlay';

// Explicit alias map for skeleton overlay joint lookup.
// Keys are lowercased display names used in drawLine(); values are ordered
// fallback aliases (also lowercased) matching native ARKit joint names.
const SKELETON_JOINT_ALIASES: Record<string, string[]> = {
  root: ['root', 'hips_joint'],
  hips_joint: ['hips_joint', 'root'],
  spine_1_joint: ['spine_1_joint'],
  spine_2_joint: ['spine_2_joint'],
  spine_3_joint: ['spine_3_joint'],
  spine_4_joint: ['spine_4_joint', 'spine_3_joint'],
  spine_5_joint: ['spine_5_joint'],
  spine_6_joint: ['spine_6_joint'],
  spine_7_joint: ['spine_7_joint'],
  neck_1_joint: ['neck_1_joint', 'neck_2_joint', 'neck_3_joint', 'neck_4_joint'],
  neck_2_joint: ['neck_2_joint', 'neck_1_joint'],
  neck_3_joint: ['neck_3_joint'],
  neck_4_joint: ['neck_4_joint'],
  head_joint: ['head_joint'],
  left_shoulder_1_joint: ['left_shoulder_1_joint'],
  left_arm_joint: ['left_arm_joint'],
  left_forearm_joint: ['left_forearm_joint'],
  left_hand_joint: ['left_hand_joint'],
  right_shoulder_1_joint: ['right_shoulder_1_joint'],
  right_arm_joint: ['right_arm_joint'],
  right_forearm_joint: ['right_forearm_joint'],
  right_hand_joint: ['right_hand_joint'],
  left_upleg_joint: ['left_upleg_joint'],
  left_leg_joint: ['left_leg_joint'],
  left_foot_joint: ['left_foot_joint'],
  right_upleg_joint: ['right_upleg_joint'],
  right_leg_joint: ['right_leg_joint'],
  right_foot_joint: ['right_foot_joint'],
};

type OverlayZone = 'core' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

type SkeletonSegment = {
  from: string;
  to: string;
  zone: OverlayZone;
};

const SKELETON_SEGMENTS: SkeletonSegment[] = [
  { from: 'hips_joint', to: 'spine_4_joint', zone: 'core' },
  { from: 'spine_4_joint', to: 'neck_1_joint', zone: 'core' },
  { from: 'neck_1_joint', to: 'head_joint', zone: 'core' },
  { from: 'neck_1_joint', to: 'left_shoulder_1_joint', zone: 'leftArm' },
  { from: 'left_shoulder_1_joint', to: 'left_arm_joint', zone: 'leftArm' },
  { from: 'left_arm_joint', to: 'left_forearm_joint', zone: 'leftArm' },
  { from: 'left_forearm_joint', to: 'left_hand_joint', zone: 'leftArm' },
  { from: 'neck_1_joint', to: 'right_shoulder_1_joint', zone: 'rightArm' },
  { from: 'right_shoulder_1_joint', to: 'right_arm_joint', zone: 'rightArm' },
  { from: 'right_arm_joint', to: 'right_forearm_joint', zone: 'rightArm' },
  { from: 'right_forearm_joint', to: 'right_hand_joint', zone: 'rightArm' },
  { from: 'hips_joint', to: 'left_upLeg_joint', zone: 'leftLeg' },
  { from: 'left_upLeg_joint', to: 'left_leg_joint', zone: 'leftLeg' },
  { from: 'left_leg_joint', to: 'left_foot_joint', zone: 'leftLeg' },
  { from: 'hips_joint', to: 'right_upLeg_joint', zone: 'rightLeg' },
  { from: 'right_upLeg_joint', to: 'right_leg_joint', zone: 'rightLeg' },
  { from: 'right_leg_joint', to: 'right_foot_joint', zone: 'rightLeg' },
];

const BASE_ZONE_COLORS: Record<OverlayZone, string> = {
  core: '#4C8CFF',
  leftArm: '#3CC8A9',
  rightArm: '#3CC8A9',
  leftLeg: '#9B7EDE',
  rightLeg: '#9B7EDE',
};

const overlayZoneForJoint = (name: string): OverlayZone => {
  const lower = name.toLowerCase();
  if (lower.includes('left') && (lower.includes('arm') || lower.includes('hand') || lower.includes('shoulder'))) return 'leftArm';
  if (lower.includes('right') && (lower.includes('arm') || lower.includes('hand') || lower.includes('shoulder'))) return 'rightArm';
  if (lower.includes('left') && (lower.includes('leg') || lower.includes('foot') || lower.includes('hip'))) return 'leftLeg';
  if (lower.includes('right') && (lower.includes('leg') || lower.includes('foot') || lower.includes('hip'))) return 'rightLeg';
  return 'core';
};

const isZoneDegraded = (zone: OverlayZone, missingComponents: Set<PullupScoringResult['missing_components'][number]>): boolean => {
  if (missingComponents.size === 0) return false;
  if (missingComponents.has('torso_stability_score') && zone === 'core') return true;
  if (missingComponents.has('rom_score') && (zone === 'leftArm' || zone === 'rightArm')) return true;
  if (missingComponents.has('symmetry_score') && zone !== 'core') return true;
  if (missingComponents.has('tempo_score')) return true;
  return false;
};

const overlayColorForZone = (zone: OverlayZone, missingComponents: Set<PullupScoringResult['missing_components'][number]>): string => (
  isZoneDegraded(zone, missingComponents) ? '#EF4444' : BASE_ZONE_COLORS[zone]
);

type ExerciseFrameGuide = {
  box: { x: number; y: number; width: number; height: number };
  accentLines: { x1: number; y1: number; x2: number; y2: number }[];
  anchor: { x: number; y: number; width: number; height: number };
  label: string;
};

const getExerciseFrameGuide = (mode: DetectionMode): ExerciseFrameGuide => {
  if (mode === 'dumbbell_curl') {
    return {
      box: { x: 0.18, y: 0.16, width: 0.64, height: 0.62 },
      accentLines: [{ x1: 0.3, y1: 0.7, x2: 0.7, y2: 0.7 }],
      anchor: { x: 0.3, y: 0.68, width: 0.4, height: 0.08 },
      label: 'Hips & arms lane',
    };
  }
  if (mode === 'pullup') {
    return {
      box: { x: 0.31, y: 0.14, width: 0.38, height: 0.76 },
      accentLines: [{ x1: 0.28, y1: 0.2, x2: 0.72, y2: 0.2 }],
      anchor: { x: 0.34, y: 0.78, width: 0.32, height: 0.08 },
      label: 'Pull lane',
    };
  }
  if (mode === 'pushup' || mode === 'benchpress') {
    return {
      box: { x: 0.12, y: 0.4, width: 0.76, height: 0.32 },
      accentLines: [{ x1: 0.16, y1: 0.56, x2: 0.84, y2: 0.56 }],
      anchor: { x: 0.18, y: 0.66, width: 0.64, height: 0.06 },
      label: 'Side lane',
    };
  }
  if (mode === 'squat' || mode === 'deadlift') {
    return {
      box: { x: 0.22, y: 0.18, width: 0.56, height: 0.72 },
      accentLines: [
        { x1: 0.32, y1: 0.82, x2: 0.68, y2: 0.82 },
        { x1: 0.5, y1: 0.18, x2: 0.5, y2: 0.9 },
      ],
      anchor: { x: 0.28, y: 0.82, width: 0.44, height: 0.07 },
      label: 'Lift lane',
    };
  }
  return {
    box: { x: 0.22, y: 0.16, width: 0.56, height: 0.74 },
    accentLines: [{ x1: 0.5, y1: 0.18, x2: 0.5, y2: 0.88 }],
    anchor: { x: 0.3, y: 0.8, width: 0.4, height: 0.07 },
    label: 'Full body lane',
  };
};


type Props = {
  pose: BodyPose2D | null;
  enabled: boolean;
  mode: DetectionMode;
  missingComponents?: PullupScoringResult['missing_components'];
  style?: StyleProp<ViewStyle>;
};

/** Keeps drawing continuity and expiry updates local to the overlay. */
export const SkeletonOverlay = memo(forwardRef<Svg, Props>(function SkeletonOverlay(
  { pose, enabled, mode, missingComponents, style }, ref,
) {
  const displayPose2DJoints = usePoseOverlay(pose?.joints, enabled, mode, pose?.timestamp);
  const overlayFrameGuide = useMemo(() => getExerciseFrameGuide(mode), [mode]);
  const missingComponentSet = useMemo(() => new Set(missingComponents), [missingComponents]);
  if (!enabled || displayPose2DJoints.length === 0) return null;

  return (
    <Svg
      ref={ref}
      style={style}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Rect
        x={overlayFrameGuide.box.x}
        y={overlayFrameGuide.box.y}
        width={overlayFrameGuide.box.width}
        height={overlayFrameGuide.box.height}
        rx="0.035"
        ry="0.035"
        stroke="#F5D06F"
        strokeWidth="0.003"
        strokeDasharray="0.018,0.014"
        fill="rgba(245, 208, 111, 0.06)"
      />
      {overlayFrameGuide.accentLines.map((line, index) => (
        <Line
          key={`frame-accent-${index}`}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="#F5D06F"
          strokeWidth="0.003"
          strokeLinecap="round"
          strokeOpacity={0.65}
        />
      ))}
      <Rect
        x={overlayFrameGuide.anchor.x}
        y={overlayFrameGuide.anchor.y}
        width={overlayFrameGuide.anchor.width}
        height={overlayFrameGuide.anchor.height}
        rx="0.03"
        ry="0.03"
        stroke="#3CC8A9"
        strokeWidth="0.003"
        fill="rgba(60, 200, 169, 0.1)"
      />
      <SvgText
        x={overlayFrameGuide.box.x + overlayFrameGuide.box.width / 2}
        y={Math.max(0.08, overlayFrameGuide.box.y - 0.025)}
        fill="#F5D06F"
        fontSize="0.025"
        fontWeight="700"
        textAnchor="middle"
      >
        {overlayFrameGuide.label}
      </SvgText>
      {(() => {
        const liveJoints = displayPose2DJoints;
        const jointsByName = new Map<string, Joint2D>();
        liveJoints.forEach((joint) => {
          jointsByName.set(joint.name.toLowerCase(), joint);
        });

        const findJoint2D = (name: string) => {
          const lower = name.toLowerCase();
          const direct = jointsByName.get(lower);
          if (direct?.isTracked) return direct;

          // Strict alias fallback -- no substring matching
          const aliases = SKELETON_JOINT_ALIASES[lower];
          if (aliases) {
            for (const alias of aliases) {
              const j = jointsByName.get(alias);
              if (j?.isTracked) return j;
            }
          }
          return undefined;
        };

        const drawLine = (segment: SkeletonSegment) => {
          const j1 = findJoint2D(segment.from);
          const j2 = findJoint2D(segment.to);
          if (j1 && j2 && j1.isTracked && j2.isTracked) {
            const isDegraded = isZoneDegraded(segment.zone, missingComponentSet);
            const x1 = j1.x;
            const y1 = j1.y;
            const x2 = j2.x;
            const y2 = j2.y;

            return (
              <Line
                key={`${segment.from}-${segment.to}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={overlayColorForZone(segment.zone, missingComponentSet)}
                strokeWidth={isDegraded ? '0.006' : '0.004'}
                strokeLinecap="round"
                strokeOpacity={isDegraded ? 1 : 0.9}
              />
            );
          }
          return null;
        };

        return (
          <>
            {SKELETON_SEGMENTS.map(drawLine)}
          </>
        );
      })()}

      {/* Draw joints from the same display-only snapshot as the bones. */}
      {displayPose2DJoints.map(
        (joint: Joint2D) => {
          if (!joint.isTracked) return null;
          return (
              <Circle
                key={`joint-${joint.name.toLowerCase()}`}
                cx={joint.x}
                cy={joint.y}
                r="0.006"
                fill={overlayColorForZone(overlayZoneForJoint(joint.name), missingComponentSet)}
                opacity={isZoneDegraded(overlayZoneForJoint(joint.name), missingComponentSet) ? 1 : 0.92}
              />
          );
        }
      )}
    </Svg>
  );
}));
