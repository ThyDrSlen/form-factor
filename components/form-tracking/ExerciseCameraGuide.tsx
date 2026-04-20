/**
 * ExerciseCameraGuide
 *
 * A dismissable card that surfaces recommended camera placement for the
 * currently-selected exercise: orientation, distance, height, lighting,
 * and top 2-3 pitfalls. Renders `ExerciseCameraGuideSvg` for the
 * schematic diagram.
 *
 * Introduced by issue #479. Mounts under the exercise-select dropdown
 * on scan-arkit.tsx (region verified orthogonal to other hot PRs).
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ExerciseCameraGuideSvg from './ExerciseCameraGuideSvg';
import {
  describeLighting,
  type CameraPlacementGuide,
} from '@/lib/services/camera-placement-guide';
import { useExerciseCameraGuide } from '@/hooks/use-exercise-camera-guide';

export interface ExerciseCameraGuideProps {
  /** The exercise key to render a guide for. */
  exerciseKey: string;
  /** Optional override — bypass the AsyncStorage-backed hook. */
  guideOverride?: CameraPlacementGuide | null;
  /** Optional container style. */
  style?: StyleProp<ViewStyle>;
  /** Called once the user dismisses the guide. */
  onDismiss?: () => void;
}

/**
 * The public component wires itself to `useExerciseCameraGuide` by default.
 * Pass `guideOverride` for tests/previews that want to render without I/O.
 */
export default function ExerciseCameraGuide({
  exerciseKey,
  guideOverride,
  style,
  onDismiss,
}: ExerciseCameraGuideProps): React.ReactElement | null {
  const hook = useExerciseCameraGuide(exerciseKey);

  // Allow an explicit override to bypass the hook entirely.
  const guide = guideOverride !== undefined ? guideOverride : hook.guide;
  const visible = guideOverride !== undefined ? guide !== null : hook.visible;

  if (!hook.ready && guideOverride === undefined) {
    return (
      <View style={[styles.loading, style]}>
        <ActivityIndicator size="small" color="#8693A8" />
      </View>
    );
  }

  if (!visible || !guide) return null;

  const handleDismiss = async () => {
    if (guideOverride === undefined) {
      await hook.dismiss();
    }
    onDismiss?.();
  };

  const handleRemember = async () => {
    if (guideOverride === undefined) {
      await hook.dismissAndRemember();
    }
    onDismiss?.();
  };

  return (
    <View style={[styles.card, style]} testID="exercise-camera-guide">
      <View style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>Camera placement</Text>
          <Text style={styles.title}>{guide.displayName}</Text>
          <Text style={styles.summary}>{guide.summary}</Text>
        </View>
        <Pressable
          style={styles.closeButton}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss camera guide for ${guide.displayName}`}
          testID="exercise-camera-guide-dismiss"
        >
          <Ionicons name="close" size={16} color="#F5F7FF" />
        </Pressable>
      </View>

      <ExerciseCameraGuideSvg guide={guide} width={280} height={158} style={styles.svgWrap} />

      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Ionicons
            name={guide.orientation === 'portrait' ? 'phone-portrait-outline' : 'phone-landscape-outline'}
            size={12}
            color="#FAB05C"
          />
          <Text style={styles.chipText}>
            {guide.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
          </Text>
        </View>
        <View style={styles.chip}>
          <Ionicons name="resize-outline" size={12} color="#FAB05C" />
          <Text style={styles.chipText}>{guide.distanceM.toFixed(1)} m back</Text>
        </View>
        <View style={styles.chip}>
          <Ionicons name="sunny-outline" size={12} color="#FAB05C" />
          <Text style={styles.chipText}>{describeLighting(guide.lightingHint)}</Text>
        </View>
      </View>

      <Text style={styles.pitfallsHeader}>Watch out for</Text>
      {guide.commonPitfalls.map((pitfall) => (
        <View key={pitfall} style={styles.pitfallRow}>
          <Ionicons name="alert-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.pitfallText}>{pitfall}</Text>
        </View>
      ))}

      <View style={styles.ctaRow}>
        <Pressable
          style={[styles.ctaButton, styles.ctaPrimary]}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityLabel="Got it"
        >
          <Text style={styles.ctaPrimaryText}>Got it</Text>
        </Pressable>
        <Pressable
          style={[styles.ctaButton, styles.ctaSecondary]}
          onPress={handleRemember}
          accessibilityRole="button"
          accessibilityLabel="Don't show again"
        >
          <Text style={styles.ctaSecondaryText}>Don&apos;t show again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'rgba(5, 14, 31, 0.94)',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(250, 176, 92, 0.25)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTextWrap: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FAB05C',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
    fontFamily: 'Lexend_700Bold',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
  },
  summary: {
    fontSize: 12,
    color: 'rgba(245, 247, 255, 0.82)',
    marginTop: 2,
    fontFamily: 'Lexend_400Regular',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  svgWrap: {
    alignSelf: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(250, 176, 92, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  chipText: {
    fontSize: 11,
    color: '#F5F7FF',
    fontFamily: 'Lexend_500Medium',
  },
  pitfallsHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8693A8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
    fontFamily: 'Lexend_500Medium',
  },
  pitfallRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  pitfallText: {
    fontSize: 12,
    color: 'rgba(245, 247, 255, 0.86)',
    flex: 1,
    lineHeight: 17,
    fontFamily: 'Lexend_400Regular',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  ctaButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimary: {
    backgroundColor: '#FAB05C',
  },
  ctaPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1A33',
    fontFamily: 'Lexend_700Bold',
  },
  ctaSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctaSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5F7FF',
    fontFamily: 'Lexend_500Medium',
  },
});
