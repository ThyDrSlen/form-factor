/**
 * ExerciseCameraGuideSvg
 *
 * A pure-SVG schematic that visualises recommended camera placement for
 * an exercise: phone silhouette, user silhouette, floor line, distance
 * dimension, lighting direction.
 *
 * Pure component — takes the placement guide as a prop and derives every
 * coordinate from it. No asset files, no external deps beyond the
 * `react-native-svg` already in the project.
 *
 * Part of issue #479.
 */

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { CameraPlacementGuide } from '@/lib/services/camera-placement-guide';

export interface ExerciseCameraGuideSvgProps {
  guide: CameraPlacementGuide;
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

const VB_WIDTH = 320;
const VB_HEIGHT = 180;

const FLOOR_Y = 150;
const USER_X = 240;
const USER_FOOT_Y = FLOOR_Y;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Project real-world meters into SVG viewBox coordinates.
 *
 * We map the full useful distance range (0.5 m - 4.0 m) onto roughly
 * 200 viewBox units so differences between e.g. pushup (1.8 m) and farmers
 * walk (3.2 m) are visually distinguishable.
 */
function projectDistanceToViewBox(distanceM: number): number {
  const clamped = clamp(distanceM, 0.5, 4.0);
  // 0.5 m -> 200 viewBox units of spacing; 4 m -> 40 units
  const spacing = 200 - (clamped - 0.5) * 45;
  return clamp(spacing, 40, 220);
}

function projectHeightToViewBox(heightM: number): number {
  // Floor is FLOOR_Y; camera height scales from 0.2 m (low) to 1.6 m (tall)
  const clamped = clamp(heightM, 0.2, 1.6);
  const fraction = (clamped - 0.2) / (1.6 - 0.2);
  return FLOOR_Y - fraction * 120;
}

function lightingGradientId(key: string): string {
  return `cam-guide-light-${key}`;
}

export default function ExerciseCameraGuideSvg({
  guide,
  width = 320,
  height = 180,
  style,
}: ExerciseCameraGuideSvgProps): React.ReactElement {
  const cameraSpacing = projectDistanceToViewBox(guide.distanceM);
  const cameraX = USER_X - cameraSpacing;
  const cameraY = projectHeightToViewBox(guide.heightM);

  const isPortrait = guide.orientation === 'portrait';
  const phoneWidth = isPortrait ? 16 : 28;
  const phoneHeight = isPortrait ? 28 : 16;

  const tiltRad = (guide.tiltDeg * Math.PI) / 180;
  // Line of sight from camera to user's torso
  const torsoY = USER_FOOT_Y - 50;
  const sightDx = USER_X - cameraX;
  const sightDy = torsoY - cameraY;

  const lightingDirection = guide.lightingHint === 'side_light_ok' ? 'side' : 'above';
  const gradId = lightingGradientId(guide.key);

  return (
    <View style={style} testID="camera-guide-svg">
      <Svg width={width} height={height} viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}>
        <Defs>
          <LinearGradient
            id={gradId}
            x1={lightingDirection === 'side' ? '0%' : '50%'}
            y1={lightingDirection === 'side' ? '50%' : '0%'}
            x2={lightingDirection === 'side' ? '100%' : '50%'}
            y2={lightingDirection === 'side' ? '50%' : '100%'}
          >
            <Stop offset="0%" stopColor="#FAB05C" stopOpacity="0.35" />
            <Stop offset="100%" stopColor="#FAB05C" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Lighting wash */}
        <Rect x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} fill={`url(#${gradId})`} />

        {/* Floor line */}
        <Line
          x1={20}
          y1={FLOOR_Y}
          x2={VB_WIDTH - 20}
          y2={FLOOR_Y}
          stroke="#5D6B83"
          strokeWidth={1.4}
          strokeDasharray="4 4"
        />

        {/* User silhouette (simple stick figure) */}
        <G>
          {/* Head */}
          <Circle cx={USER_X} cy={USER_FOOT_Y - 110} r={10} fill="#F5F7FF" />
          {/* Torso */}
          <Line
            x1={USER_X}
            y1={USER_FOOT_Y - 100}
            x2={USER_X}
            y2={USER_FOOT_Y - 50}
            stroke="#F5F7FF"
            strokeWidth={3}
            strokeLinecap="round"
          />
          {/* Arms */}
          <Line
            x1={USER_X}
            y1={USER_FOOT_Y - 90}
            x2={USER_X - 16}
            y2={USER_FOOT_Y - 65}
            stroke="#F5F7FF"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <Line
            x1={USER_X}
            y1={USER_FOOT_Y - 90}
            x2={USER_X + 16}
            y2={USER_FOOT_Y - 65}
            stroke="#F5F7FF"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* Legs */}
          <Line
            x1={USER_X}
            y1={USER_FOOT_Y - 50}
            x2={USER_X - 12}
            y2={USER_FOOT_Y}
            stroke="#F5F7FF"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <Line
            x1={USER_X}
            y1={USER_FOOT_Y - 50}
            x2={USER_X + 12}
            y2={USER_FOOT_Y}
            stroke="#F5F7FF"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </G>

        {/* Line of sight */}
        <Line
          x1={cameraX + phoneWidth / 2}
          y1={cameraY}
          x2={cameraX + phoneWidth / 2 + sightDx}
          y2={cameraY + sightDy}
          stroke="#3CC8A9"
          strokeWidth={1.2}
          strokeDasharray="2 3"
          opacity={0.7}
        />

        {/* Phone silhouette */}
        <G
          transform={`rotate(${-guide.tiltDeg} ${cameraX + phoneWidth / 2} ${cameraY})`}
        >
          <Rect
            x={cameraX}
            y={cameraY - phoneHeight}
            width={phoneWidth}
            height={phoneHeight}
            rx={3}
            ry={3}
            fill="#0B1A33"
            stroke="#FAB05C"
            strokeWidth={1.5}
          />
          {/* Lens dot */}
          <Circle
            cx={cameraX + phoneWidth / 2}
            cy={cameraY - phoneHeight / 2}
            r={2.5}
            fill="#FAB05C"
          />
        </G>

        {/* Distance dimension */}
        <G>
          <Line
            x1={cameraX + phoneWidth / 2}
            y1={FLOOR_Y + 12}
            x2={USER_X}
            y2={FLOOR_Y + 12}
            stroke="#8693A8"
            strokeWidth={1}
          />
          <Line
            x1={cameraX + phoneWidth / 2}
            y1={FLOOR_Y + 8}
            x2={cameraX + phoneWidth / 2}
            y2={FLOOR_Y + 16}
            stroke="#8693A8"
            strokeWidth={1}
          />
          <Line
            x1={USER_X}
            y1={FLOOR_Y + 8}
            x2={USER_X}
            y2={FLOOR_Y + 16}
            stroke="#8693A8"
            strokeWidth={1}
          />
          <SvgText
            x={(cameraX + phoneWidth / 2 + USER_X) / 2}
            y={FLOOR_Y + 28}
            fill="#F5F7FF"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            {guide.distanceM.toFixed(1)} m
          </SvgText>
        </G>

        {/* Height dimension (left side) */}
        <G>
          <Line
            x1={12}
            y1={cameraY}
            x2={12}
            y2={FLOOR_Y}
            stroke="#8693A8"
            strokeWidth={1}
          />
          <SvgText
            x={16}
            y={(cameraY + FLOOR_Y) / 2 + 3}
            fill="#F5F7FF"
            fontSize="9"
            fontWeight="600"
          >
            {guide.heightM.toFixed(1)} m
          </SvgText>
        </G>

        {/* Orientation tag */}
        <SvgText
          x={cameraX + phoneWidth / 2}
          y={cameraY - phoneHeight - 6}
          fill="#FAB05C"
          fontSize="9"
          fontWeight="700"
          textAnchor="middle"
        >
          {isPortrait ? 'PORTRAIT' : 'LANDSCAPE'}
        </SvgText>

        {/* Tilt arrow when non-zero */}
        {guide.tiltDeg !== 0 && (
          <Path
            d={`M ${cameraX + phoneWidth + 6} ${cameraY - phoneHeight / 2} l 6 -3 l 0 2 l -4 1 l 0 4 l 4 1 l 0 2 z`}
            fill="#FAB05C"
            transform={`rotate(${tiltRad > 0 ? -10 : 10} ${cameraX + phoneWidth + 9} ${cameraY - phoneHeight / 2})`}
          />
        )}
      </Svg>
    </View>
  );
}
