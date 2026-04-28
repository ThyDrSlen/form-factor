/**
 * CueCard
 *
 * Color-coded, prioritized form-fault callout card rendered in the ARKit
 * overlay. Replaces the plain-text feedback list with a visual hierarchy:
 *
 *   critical (red)    — set-stopping fault, fix now
 *   warning  (orange) — form is drifting, correct within the next rep
 *   advisory (yellow) — coaching tip, non-blocking
 *
 * The card picks an icon based on the detected fault type (rom, tempo,
 * alignment, visibility, generic) and fades in whenever the message
 * changes. If no cues are active, the component renders null.
 *
 * Pure UI — the caller decides which cue to surface. A helper
 * `classifyCue` is exported so consumers can convert a free-text coach
 * message into a typed `CueEntry` with priority + fault type.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { createError, logError } from '@/lib/services/ErrorHandler';

export type CuePriority = 'critical' | 'warning' | 'advisory';

export type CueFaultType =
  | 'rom'
  | 'tempo'
  | 'alignment'
  | 'visibility'
  | 'setup'
  | 'generic';

export interface CueEntry {
  message: string;
  priority: CuePriority;
  faultType: CueFaultType;
}

export interface CueCardProps {
  /** The (already prioritized) cue to render. Pass null to hide. */
  cue: CueEntry | null;
  /** Optional extra style for absolute positioning in the overlay. */
  style?: StyleProp<ViewStyle>;
  /** Optional testID for component tests. */
  testID?: string;
}

type Palette = { bg: string; border: string; text: string; accent: string };

const PRIORITY_PALETTE: Record<CuePriority, Palette> = {
  critical: {
    bg: 'rgba(180, 30, 30, 0.92)',
    border: '#FF3B30',
    text: '#FFFFFF',
    accent: '#FFE0DC',
  },
  warning: {
    bg: 'rgba(160, 90, 10, 0.92)',
    border: '#FF9A3C',
    text: '#FFFFFF',
    accent: '#FFE4C7',
  },
  advisory: {
    bg: 'rgba(105, 85, 10, 0.92)',
    border: '#FFC244',
    text: '#FFFFFF',
    accent: '#FFF0B8',
  },
};

const FAULT_ICON: Record<CueFaultType, keyof typeof Ionicons.glyphMap> = {
  rom: 'expand-outline',
  tempo: 'speedometer-outline',
  alignment: 'git-compare-outline',
  visibility: 'eye-off-outline',
  setup: 'construct-outline',
  generic: 'information-circle-outline',
};

const PRIORITY_LABEL: Record<CuePriority, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  advisory: 'TIP',
};

/**
 * Heuristic classifier for an ad-hoc coach string. Used by scan-arkit so we
 * can render the new card without rewiring the analyzeForm pipeline.
 */
export function classifyCue(message: string): CueEntry {
  const lower = message.toLowerCase();

  const critical = /(stop|danger|unsafe|lower the (weight|bar)|cannot detect)/.test(lower);
  const visibility =
    /(frame|camera|visible|visibility|step back|move (into|closer))/.test(lower);
  const rom = /(range of motion|rom|go deeper|full extension|lockout|partial)/.test(lower);
  const tempo = /(slow down|too fast|speed|tempo|pause)/.test(lower);
  const alignment = /(knee|elbow|back|chest|shoulder|hips?|straight|neutral)/.test(lower);
  const setup = /(set up|hand placement|grip|stance|feet)/.test(lower);

  let faultType: CueFaultType = 'generic';
  if (visibility) faultType = 'visibility';
  else if (rom) faultType = 'rom';
  else if (tempo) faultType = 'tempo';
  else if (alignment) faultType = 'alignment';
  else if (setup) faultType = 'setup';

  let priority: CuePriority = 'advisory';
  if (critical || visibility) priority = 'critical';
  else if (rom || alignment || tempo) priority = 'warning';

  return { message, priority, faultType };
}

export default function CueCard({ cue, style, testID }: CueCardProps) {
  const palette = cue ? PRIORITY_PALETTE[cue.priority] : null;
  const icon = cue ? FAULT_ICON[cue.faultType] : null;

  // Re-mount on message change so the fade-in replays.
  const motiKey = useMemo(() => cue?.message ?? 'empty', [cue?.message]);

  // Defensive guard: the cue-engine contract requires `message` to be
  // non-empty (rules define `message: string` as required, with variant
  // fallback on empty). A silent/empty cue is worse UX than no cue, so we
  // bail out and log it so regressions surface in telemetry.
  const isEmptyMessage = !!cue && cue.message.trim() === '';
  useEffect(() => {
    if (isEmptyMessage && cue) {
      logError(
        createError(
          'form-tracking',
          'CUE_EMPTY_MESSAGE',
          'CueCard received a cue with an empty message string',
          {
            details: { priority: cue.priority, faultType: cue.faultType },
            severity: 'warning',
          },
        ),
        { feature: 'form-tracking', location: 'CueCard' },
      );
    }
  }, [isEmptyMessage, cue]);

  if (!cue || !palette || !icon || isEmptyMessage) {
    return null;
  }

  const accessibilityLabel = `${PRIORITY_LABEL[cue.priority]} form cue: ${cue.message}`;

  return (
    <MotiView
      key={motiKey}
      from={{ opacity: 0, translateY: 6 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: -6 }}
      transition={{ type: 'timing', duration: 220 }}
      style={[
        styles.card,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion={cue.priority === 'critical' ? 'assertive' : 'polite'}
      accessibilityLabel={accessibilityLabel}
      testID={testID ?? 'cue-card'}
    >
      <View style={styles.row}>
        <View style={[styles.iconBubble, { backgroundColor: palette.border }]}>
          <Ionicons name={icon} size={18} color={palette.text} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.tag, { color: palette.accent }]} accessibilityElementsHidden>
            {PRIORITY_LABEL[cue.priority]}
          </Text>
          <Text style={[styles.message, { color: palette.text }]}>{cue.message}</Text>
        </View>
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  tag: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
});
