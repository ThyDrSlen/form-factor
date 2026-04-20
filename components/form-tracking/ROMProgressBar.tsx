/**
 * ROMProgressBar — body-anchored horizontal progress bar showing ROM
 * progression through the rep. Concentric phase fills left-to-right in
 * blue; eccentric phase fills right-to-left in cyan.
 *
 * Positioned just above the anchor joint so it tracks with the user
 * rather than floating at a fixed screen corner.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { Joint2D } from '@/lib/arkit/ARKitBodyTracker';

export type ROMPhase = 'concentric' | 'eccentric';

export type ROMProgressBarProps = {
  anchor: Joint2D;
  /** 0..1 progression through the current phase. */
  progress: number;
  phase: ROMPhase;
  width: number;
  height: number;
  /** Bar width in px. Defaults to 120. */
  barWidth?: number;
  /** Bar height in px. Defaults to 6. */
  barHeight?: number;
  /** Vertical offset (in px) above the joint. Negative = higher. */
  offsetAbove?: number;
};

export const PHASE_COLORS: Record<ROMPhase, string> = {
  concentric: '#4C8CFF',
  eccentric: '#22D3EE',
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Compute fill rectangle for a given progress/phase. Concentric phase
 * fills left-to-right, eccentric phase fills right-to-left.
 */
export function computeFillRect(
  progress: number,
  phase: ROMPhase,
  barX: number,
  barY: number,
  barWidth: number,
  barHeight: number,
): { x: number; y: number; width: number; height: number } {
  const p = clamp01(progress);
  if (phase === 'concentric') {
    return { x: barX, y: barY, width: barWidth * p, height: barHeight };
  }
  // eccentric: fill from the right
  return {
    x: barX + barWidth * (1 - p),
    y: barY,
    width: barWidth * p,
    height: barHeight,
  };
}

export function ROMProgressBar({
  anchor,
  progress,
  phase,
  width,
  height,
  barWidth = 120,
  barHeight = 6,
  offsetAbove = -56,
}: ROMProgressBarProps) {
  if (!anchor?.isTracked) return null;

  const cx = anchor.x * width;
  const cy = anchor.y * height;
  const barX = cx - barWidth / 2;
  const barY = cy + offsetAbove;
  const color = PHASE_COLORS[phase];
  const fill = computeFillRect(progress, phase, barX, barY, barWidth, barHeight);

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={`${phase} progress ${Math.round(clamp01(progress) * 100)} percent`}
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Rect
          x={barX}
          y={barY}
          width={barWidth}
          height={barHeight}
          rx={barHeight / 2}
          ry={barHeight / 2}
          fill="rgba(255,255,255,0.18)"
        />
        {fill.width > 0 ? (
          <Rect
            x={fill.x}
            y={fill.y}
            width={fill.width}
            height={fill.height}
            rx={barHeight / 2}
            ry={barHeight / 2}
            fill={color}
          />
        ) : null}
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
