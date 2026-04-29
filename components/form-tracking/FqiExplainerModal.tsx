/**
 * FqiExplainerModal
 *
 * In-context explainer that appears when the user taps the FormQualityBadge
 * or FqiGauge. Covers three things in one sheet:
 *
 *   1. What the FQI (Form Quality Index) actually measures — joint angles,
 *      tempo, depth, symmetry. Two-three sentences, friendly but concrete.
 *   2. The color-tier legend so users can map the badge tint to meaning.
 *   3. Three generic improvement tips keyed to common failure modes
 *      (rushed tempo, shallow depth, left/right asymmetry).
 *
 * An optional secondary CTA — "See drills for this exercise" — only renders
 * when the caller passes an `exerciseId`, routing to the form-quality
 * recovery modal with that exercise pre-selected.
 *
 * Visual style mirrors DrillSheet (dark-navy card over a dimmed backdrop)
 * so the surface feels native to the form-tracking flow. Font weights use
 * Lexend_ ^/500/700 to match the rest of the app.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { warnWithTs } from '@/lib/logger';
import { getFqiColor } from './FqiGauge';

export interface FqiExplainerModalProps {
  /** Controls visibility. */
  visible: boolean;
  /** Called when the user dismisses the modal (backdrop / close button / hw back). */
  onDismiss: () => void;
  /**
   * Canonical exercise id. When provided, a secondary CTA appears that
   * routes to `/(modals)/form-quality-recovery?exerciseId=<id>` so the
   * user can pivot from "what is FQI" to "how do I fix it for this lift".
   */
  exerciseId?: string;
  /** Optional testID override. Defaults to `fqi-explainer-modal`. */
  testID?: string;
}

interface TierRow {
  range: string;
  label: string;
  /** Hex color sourced from `getFqiColor` so the legend matches the live UI. */
  color: string;
}

// The legend tiers below intentionally mirror the tier boundaries in
// `getFqiColor` plus the higher-precision bands described in the product
// spec. `getFqiColor` is the source of truth for colors; labels below are
// the user-facing copy.
const TIER_ROWS: TierRow[] = [
  { range: '85+', label: 'Excellent', color: getFqiColor(90).fill },
  { range: '65–84', label: 'Good', color: getFqiColor(75).fill },
  { range: '45–64', label: 'Needs work', color: getFqiColor(55).fill },
  { range: '< 45', label: 'Refocus on basics', color: getFqiColor(30).fill },
];

const IMPROVEMENT_TIPS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  {
    icon: 'timer-outline',
    text: 'Slow the eccentric — count 2–3s on the way down to stabilise tempo.',
  },
  {
    icon: 'trending-down-outline',
    text: 'Hit full depth every rep. Partial reps drag FQI more than missing weight.',
  },
  {
    icon: 'swap-horizontal-outline',
    text: 'Keep left and right even. Asymmetry > 5° costs points on every rep.',
  },
];

export function FqiExplainerModal({
  visible,
  onDismiss,
  exerciseId,
  testID = 'fqi-explainer-modal',
}: FqiExplainerModalProps) {
  const router = useRouter();

  const handleSeeDrills = (): void => {
    if (!exerciseId) return;
    onDismiss();
    const encoded = encodeURIComponent(exerciseId);
    // Guard against a bad route (e.g. registry out-of-sync after a refactor)
    // so the crash doesn't propagate past the dismissed modal. router.push
    // throws synchronously for invalid routes in expo-router.
    try {
      router.push(`/(modals)/form-quality-recovery?exerciseId=${encoded}` as `/${string}`);
    } catch (err) {
      warnWithTs('[FqiExplainerModal] router.push to form-quality-recovery failed', err);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      testID={testID}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss form quality explainer"
        testID={`${testID}-backdrop`}
      />
      <View style={styles.sheet} accessibilityLabel="What is form quality">
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>What is Form Quality?</Text>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            testID={`${testID}-close`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={20} color="#F5F7FF" />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.body}>
            FQI (Form Quality Index) is a single 0–100 score that combines
            joint-angle alignment, tempo consistency, depth, and left/right
            symmetry. Each rep gets its own score; the badge shows the
            session average. Higher is better.
          </Text>

          <Text style={styles.sectionTitle}>Legend</Text>
          <View style={styles.legend} testID={`${testID}-legend`}>
            {TIER_ROWS.map((tier) => (
              <View
                key={tier.label}
                style={styles.legendRow}
                testID={`${testID}-legend-${tier.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <View style={[styles.swatch, { backgroundColor: tier.color }]} />
                <View style={styles.legendText}>
                  <Text style={styles.legendRange}>{tier.range}</Text>
                  <Text style={styles.legendLabel}>{tier.label}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Quick wins</Text>
          <View style={styles.tipList} testID={`${testID}-tips`}>
            {IMPROVEMENT_TIPS.map((tip) => (
              <View key={tip.text} style={styles.tipRow}>
                <Ionicons name={tip.icon} size={16} color="#4C8CFF" />
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {exerciseId ? (
          <Pressable
            onPress={handleSeeDrills}
            accessibilityRole="button"
            accessibilityLabel="See drills for this exercise"
            style={({ pressed }) => [styles.drillsCta, pressed && styles.pressed]}
            testID={`${testID}-see-drills`}
          >
            <Ionicons name="barbell-outline" size={16} color="#FFFFFF" />
            <Text style={styles.drillsCtaText}>See drills for this exercise</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close explainer"
          style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
          testID={`${testID}-dismiss`}
        >
          <Text style={styles.dismissText}>Got it</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: '#0D1530',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  scroll: {
    maxHeight: 460,
  },
  scrollContent: {
    paddingBottom: 8,
    gap: 14,
  },
  body: {
    color: 'rgba(220, 228, 245, 0.9)',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    lineHeight: 21,
  },
  sectionTitle: {
    color: '#C9D7F4',
    fontFamily: 'Lexend_700Bold',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
  },
  legend: {
    gap: 10,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendText: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  legendRange: {
    color: '#F5F7FF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 60,
  },
  legendLabel: {
    color: 'rgba(220, 228, 245, 0.85)',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
  },
  tipList: {
    gap: 10,
  },
  tipRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  tipText: {
    color: 'rgba(220, 228, 245, 0.9)',
    fontFamily: 'Lexend_400Regular',
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  drillsCta: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#4C8CFF',
  },
  drillsCtaText: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_700Bold',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissBtn: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissText: {
    color: 'rgba(220, 228, 245, 0.75)',
    fontFamily: 'Lexend_500Medium',
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.75,
  },
});

export default FqiExplainerModal;
