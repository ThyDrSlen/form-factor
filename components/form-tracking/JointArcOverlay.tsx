/**
 * JointArcOverlay — SVG arc rendered at an active joint showing the
 * current angle relative to a target ROM range. Color is interpolated
 * green (centered in range) through yellow to red (past either bound)
 * so users get glanceable feedback on whether they're clearing the
 * concentric/eccentric targets.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

export type JointArcOverlayProps = {
  activeJoint: Joint2D;
  currentAngle: number;
  minROM: number;
  maxROM: number;
  /** Canvas width in px. Used to project normalized joint.x. */
  width: number;
  height: number;
  /** Arc radius in px. Defaults to 36. */
  radius?: number;
  /** Stroke width for the arc. Defaults to 6. */
  strokeWidth?: number;
  /** Hide numeric readout. */
  hideLabel?: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Pure function: given current/min/max angles, returns a 0..1 progress value
 * where 0 = at minROM (or below), 0.5 = midpoint, 1 = at maxROM (or above).
 */
export function romProgress(current: number, minROM: number, maxROM: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(minROM) || !Number.isFinite(maxROM)) {
    return 0;
  }
  if (maxROM <= minROM) return 0;
  return clamp((current - minROM) / (maxROM - minROM), 0, 1);
}

/**
 * Interpolate color from green -> yellow -> red based on how far the
 * angle is from the mid-point of [minROM, maxROM]. Values in the
 * comfortable middle third stay green; edges fade to orange/red.
 */
export function romColor(current: number, minROM: number, maxROM: number): string {
  const progress = romProgress(current, minROM, maxROM);
  // Distance from midpoint, normalised 0..1 (0 = centered, 1 = at edge)
  const distFromMid = Math.abs(progress - 0.5) * 2;
  if (distFromMid < 0.33) return '#22C55E'; // green
  if (distFromMid < 0.66) return '#F59E0B'; // amber
  return '#EF4444'; // red
}

/**
 * Build an SVG arc `d` path spanning sweepAngle (radians) centered on
 * the joint, starting at the -90° (top) direction.
 */
function buildArcPath(
  cx: number,
  cy: number,
  radius: number,
  sweepRadians: number,
): string {
  const startAngle = -Math.PI / 2; // top
  const endAngle = startAngle + sweepRadians;
  const startX = cx + radius * Math.cos(startAngle);
  const startY = cy + radius * Math.sin(startAngle);
  const endX = cx + radius * Math.cos(endAngle);
  const endY = cy + radius * Math.sin(endAngle);
  const largeArc = sweepRadians > Math.PI ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

export function JointArcOverlay({
  activeJoint,
  currentAngle,
  minROM,
  maxROM,
  width,
  height,
  radius = 36,
  strokeWidth = 6,
  hideLabel,
}: JointArcOverlayProps) {
  const cx = activeJoint?.x ? activeJoint.x * width : width / 2;
  const cy = activeJoint?.y ? activeJoint.y * height : height / 2;
  const progress = useMemo(
    () => romProgress(currentAngle, minROM, maxROM),
    [currentAngle, minROM, maxROM],
  );
  const color = useMemo(
    () => romColor(currentAngle, minROM, maxROM),
    [currentAngle, minROM, maxROM],
  );
  const sweep = progress * (Math.PI * 1.5); // up to 270°
  const arcPath = useMemo(
    () => buildArcPath(cx, cy, radius, Math.max(sweep, 0.01)),
    [cx, cy, radius, sweep],
  );

  if (!activeJoint?.isTracked) {
    return null;
  }

  const labelY = cy - radius - 12;
  const labelX = cx;

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Joint angle ${Math.round(currentAngle)} degrees`}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Path
          d={arcPath}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      {hideLabel ? null : (
        <View style={[styles.label, { left: labelX - 28, top: labelY }]}>
          <Text style={[styles.labelText, { color }]}>
            {Math.round(currentAngle)}°
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  label: {
    position: 'absolute',
    width: 56,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingVertical: 2,
  },
  labelText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
