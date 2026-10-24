/**
 * CueArrowOverlay — body-anchored directional arrow.
 *
 * Given a joint and a 2D direction vector, renders an SVG arrow pointing
 * that way. Severity colors: info = blue, warn = amber, error = red. The
 * direction vector is expected in the same normalized coordinate space as
 * joints (values roughly -1..1 are fine; they're normalized internally).
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polygon, Line } from 'react-native-svg';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

export type CueSeverity = 'info' | 'warn' | 'error';

export type CueArrowOverlayProps = {
  joint: Joint2D;
  direction: { x: number; y: number };
  severity?: CueSeverity;
  width: number;
  height: number;
  /** Arrow shaft length in px. Defaults to 48. */
  length?: number;
  /** Arrow head size in px. Defaults to 10. */
  headSize?: number;
};

export const SEVERITY_COLORS: Record<CueSeverity, string> = {
  info: '#4C8CFF',
  warn: '#F59E0B',
  error: '#EF4444',
};

export function normalizeVector(
  dx: number,
  dy: number,
): { x: number; y: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { x: 0, y: 0 };
  }
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag < 1e-6) return { x: 0, y: 0 };
  return { x: dx / mag, y: dy / mag };
}

export function CueArrowOverlay({
  joint,
  direction,
  severity = 'info',
  width,
  height,
  length = 48,
  headSize = 10,
}: CueArrowOverlayProps) {
  const color = SEVERITY_COLORS[severity];

  const geometry = useMemo(() => {
    const anchor = normalizeVector(direction.x, direction.y);
    if (anchor.x === 0 && anchor.y === 0) return null;
    const cx = joint.x * width;
    const cy = joint.y * height;
    const tipX = cx + anchor.x * length;
    const tipY = cy + anchor.y * length;
    // Perpendicular for arrowhead base
    const perpX = -anchor.y;
    const perpY = anchor.x;
    const baseX = tipX - anchor.x * headSize;
    const baseY = tipY - anchor.y * headSize;
    const leftX = baseX + perpX * (headSize / 2);
    const leftY = baseY + perpY * (headSize / 2);
    const rightX = baseX - perpX * (headSize / 2);
    const rightY = baseY - perpY * (headSize / 2);
    return {
      cx,
      cy,
      tipX,
      tipY,
      leftX,
      leftY,
      rightX,
      rightY,
    };
  }, [joint.x, joint.y, width, height, direction.x, direction.y, length, headSize]);

  if (!joint?.isTracked || !geometry) {
    return null;
  }

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Cue arrow severity ${severity}`}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Circle cx={geometry.cx} cy={geometry.cy} r={4} fill={color} />
        <Line
          x1={geometry.cx}
          y1={geometry.cy}
          x2={geometry.tipX}
          y2={geometry.tipY}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Polygon
          points={`${geometry.tipX},${geometry.tipY} ${geometry.leftX},${geometry.leftY} ${geometry.rightX},${geometry.rightY}`}
          fill={color}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
