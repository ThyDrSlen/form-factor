/**
 * FramingGuide — SVG overlay drawing a bounding box around the tracked
 * subject with distance/position hints ("Step back", "Lift phone",
 * "Center yourself"). Hints are derived from Joint2D edge proximity on
 * screen-space normalized coordinates (0..1).
 *
 * The overlay is intentionally passive — it only reads joints and
 * renders. Hosts feed it the latest smoothed Joint2D array.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

export type FramingHint =
  | 'centered'
  | 'too_close'
  | 'too_far'
  | 'too_left'
  | 'too_right'
  | 'too_high'
  | 'too_low'
  | 'not_visible';

export type FramingGuideProps = {
  /** Smoothed Joint2D array in 0..1 screen space. */
  joints: Joint2D[] | null | undefined;
  width: number;
  height: number;
  /** Min/max normalized box size for "ideal" framing. Defaults ~0.35-0.75. */
  minBoxRatio?: number;
  maxBoxRatio?: number;
  /** Padding margin (0..1) from each edge before "too close" flags. */
  edgeMargin?: number;
  /** Hide the hint pill (keep the frame only). */
  hideHint?: boolean;
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
};

function computeBounds(joints: Joint2D[]): Bounds {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  let count = 0;
  for (const j of joints) {
    if (!j?.isTracked) continue;
    if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) continue;
    if (j.x < minX) minX = j.x;
    if (j.x > maxX) maxX = j.x;
    if (j.y < minY) minY = j.y;
    if (j.y > maxY) maxY = j.y;
    count += 1;
  }
  return { minX, maxX, minY, maxY, count };
}

export function computeFramingHint(
  joints: Joint2D[] | null | undefined,
  opts?: Pick<FramingGuideProps, 'minBoxRatio' | 'maxBoxRatio' | 'edgeMargin'>,
): { hint: FramingHint; bounds: Bounds | null } {
  if (!joints || joints.length === 0) {
    return { hint: 'not_visible', bounds: null };
  }
  const bounds = computeBounds(joints);
  if (bounds.count < 4) {
    return { hint: 'not_visible', bounds: null };
  }
  const minBoxRatio = opts?.minBoxRatio ?? 0.35;
  const maxBoxRatio = opts?.maxBoxRatio ?? 0.75;
  const edgeMargin = opts?.edgeMargin ?? 0.04;

  const widthRatio = bounds.maxX - bounds.minX;
  const heightRatio = bounds.maxY - bounds.minY;
  const dominant = Math.max(widthRatio, heightRatio);

  if (bounds.minX < edgeMargin) return { hint: 'too_left', bounds };
  if (bounds.maxX > 1 - edgeMargin) return { hint: 'too_right', bounds };
  if (bounds.minY < edgeMargin) return { hint: 'too_high', bounds };
  if (bounds.maxY > 1 - edgeMargin) return { hint: 'too_low', bounds };
  if (dominant > maxBoxRatio) return { hint: 'too_close', bounds };
  if (dominant < minBoxRatio) return { hint: 'too_far', bounds };
  return { hint: 'centered', bounds };
}

export const HINT_MESSAGES: Record<FramingHint, string> = {
  centered: 'Framing looks good',
  too_close: 'Step back',
  too_far: 'Step closer',
  too_left: 'Move right',
  too_right: 'Move left',
  too_high: 'Lift phone',
  too_low: 'Lower phone',
  not_visible: 'Step into frame',
};

const HINT_COLORS: Record<FramingHint, string> = {
  centered: '#22C55E',
  too_close: '#F97316',
  too_far: '#F97316',
  too_left: '#F59E0B',
  too_right: '#F59E0B',
  too_high: '#F59E0B',
  too_low: '#F59E0B',
  not_visible: '#EF4444',
};

export function FramingGuide({
  joints,
  width,
  height,
  minBoxRatio,
  maxBoxRatio,
  edgeMargin,
  hideHint,
}: FramingGuideProps) {
  const { hint, bounds } = useMemo(
    () => computeFramingHint(joints, { minBoxRatio, maxBoxRatio, edgeMargin }),
    [joints, minBoxRatio, maxBoxRatio, edgeMargin],
  );

  const rect = useMemo(() => {
    if (!bounds) return null;
    const x = bounds.minX * width;
    const y = bounds.minY * height;
    const w = (bounds.maxX - bounds.minX) * width;
    const h = (bounds.maxY - bounds.minY) * height;
    return { x, y, w, h };
  }, [bounds, width, height]);

  const color = HINT_COLORS[hint];

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Framing hint: ${HINT_MESSAGES[hint]}`}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {rect ? (
          <Rect
            x={rect.x}
            y={rect.y}
            width={Math.max(rect.w, 1)}
            height={Math.max(rect.h, 1)}
            stroke={color}
            strokeWidth={2}
            strokeDasharray="8,6"
            fill="none"
          />
        ) : null}
      </Svg>
      {hideHint ? null : (
        <View style={[styles.pill, { borderColor: color }]}>
          <View style={[styles.pillDot, { backgroundColor: color }]} />
          <Text style={styles.pillText}>{HINT_MESSAGES[hint]}</Text>
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
  pill: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    color: '#F5F7FF',
    fontSize: 13,
    fontWeight: '600',
  },
});
