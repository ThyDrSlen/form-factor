import type { Joint2D, JointAngles } from '@/lib/arkit/ARKitBodyTracker';
import type { FormTargets } from '@/lib/services/form-target-resolver';
import { View, StyleSheet } from 'react-native';
import { FramingGuide } from '@/features/form-tracking/components/FramingGuide';
import { JointArcOverlay } from '@/features/form-tracking/components/JointArcOverlay';
import { CueArrowOverlay, type CueSeverity } from '@/features/form-tracking/components/CueArrowOverlay';
import { ROMProgressBar } from '@/features/form-tracking/components/ROMProgressBar';
import { FaultHighlight } from '@/features/form-tracking/components/FaultHighlight';

// =============================================================
// AR overlays sub-component (#445 W3-D) — extracted so the main
// scan screen stays readable. All SVG overlays live here.
// =============================================================
export type ARScanOverlaysV2Props = {
  joints: Joint2D[];
  width: number;
  height: number;
  angles: JointAngles | null;
  activeFormTargets: FormTargets;
  activePhase: string;
};

export function findJointByNames(joints: Joint2D[], names: string[]): Joint2D | null {
  const lowered = new Set(names.map((n) => n.toLowerCase()));
  for (const j of joints) {
    if (j?.name && lowered.has(j.name.toLowerCase()) && j.isTracked) return j;
  }
  return null;
}

export function angleFromAngles(
  angles: JointAngles | null,
  keys: string[],
): number | null {
  if (!angles) return null;
  const rec = angles as unknown as Record<string, number | undefined>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function ARScanOverlaysV2({
  joints,
  width,
  height,
  angles,
  activeFormTargets,
  activePhase,
}: ARScanOverlaysV2Props) {
  const elbow = findJointByNames(joints, [
    'left_forearm_joint',
    'left_elbow',
    'right_forearm_joint',
    'right_elbow',
  ]);
  const shoulder = findJointByNames(joints, [
    'left_shoulder_1_joint',
    'left_shoulder',
    'right_shoulder_1_joint',
    'right_shoulder',
  ]);
  const hip = findJointByNames(joints, [
    'hips_joint',
    'left_hip',
    'right_hip',
  ]);

  const armAngle =
    angleFromAngles(angles, [
      'leftElbow',
      'rightElbow',
      'leftArm',
      'rightArm',
    ]) ?? 90;

  // Use targets from the active form-target record when available.
  const minROM = Number.isFinite(activeFormTargets?.romMin)
    ? (activeFormTargets.romMin as number)
    : 30;
  const maxROM = Number.isFinite(activeFormTargets?.romMax)
    ? (activeFormTargets.romMax as number)
    : 170;

  // Derive a rough progress value and phase classification for the ROM bar.
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const romProgress = clamp01(
    (armAngle - minROM) / Math.max(1, maxROM - minROM),
  );
  const isConcentric =
    activePhase.toLowerCase().includes('up') ||
    activePhase.toLowerCase().includes('concentric') ||
    activePhase.toLowerCase().includes('pull') ||
    activePhase.toLowerCase().includes('ascend');

  return (
    <View pointerEvents="none" style={{ position: 'absolute', width, height }}>
      <FramingGuide joints={joints} width={width} height={height} />
      {elbow ? (
        <JointArcOverlay
          activeJoint={elbow}
          currentAngle={armAngle}
          minROM={minROM}
          maxROM={maxROM}
          width={width}
          height={height}
        />
      ) : null}
      {shoulder ? (
        <CueArrowOverlay
          joint={shoulder}
          direction={{ x: 0, y: -1 }}
          severity={('info' as CueSeverity)}
          width={width}
          height={height}
        />
      ) : null}
      {hip ? (
        <ROMProgressBar
          anchor={hip}
          progress={romProgress}
          phase={isConcentric ? 'concentric' : 'eccentric'}
          width={width}
          height={height}
        />
      ) : null}
      <FaultHighlight
        joints={joints}
        faultJointNames={[]}
        width={width}
        height={height}
      />
    </View>
  );
}

export const scanArV2Styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE047',
    backgroundColor: 'rgba(17,17,17,0.78)',
  },
  bannerError: {
    borderColor: '#FCA5A5',
  },
  bannerInfo: {
    borderColor: '#93C5FD',
  },
  bannerText: {
    flex: 1,
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
  bannerAction: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  bannerActionText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '700',
  },
  bannerDismiss: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginLeft: 6,
  },
  recoveredPulse: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(190, 242, 100, 0.8)',
    backgroundColor: 'rgba(190, 242, 100, 0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 170,
  },
  recoveredPulseText: {
    color: '#0B1F3A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  microToast: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  microToastText: {
    color: '#F5F7FF',
    fontSize: 12,
    fontWeight: '600',
  },
  fpsBadge: {
    position: 'absolute',
    top: 8,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(248,113,113,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.6)',
  },
  fpsBadgeText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
