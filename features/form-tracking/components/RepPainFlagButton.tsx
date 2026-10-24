/**
 * RepPainFlagButton
 *
 * Button + modal workflow for flagging pain/injury on a specific rep.
 * Opens a modal with:
 *   - Location picker (lower_back / upper_back / knee / shoulder / elbow /
 *     wrist / hip / other)
 *   - Severity slider (1-5)
 *   - Free-form notes (optional, capped at 500 chars)
 *   - "Log & adjust next set" CTA that writes the flag and emits an
 *     adjustNextSetWeight recommendation. Host UI wires the recommendation
 *     into the session runner when it's ready (see TODO inside the service).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  adjustNextSetWeight,
  flagRepPain,
  PAIN_LOCATION_LABELS,
  type PainFlag,
  type PainLocation,
  type PainSeverity,
} from '@/lib/services/rep-pain-journal';
import { errorWithTs } from '@/lib/logger';

// =============================================================================
// Props
// =============================================================================

export interface RepPainFlagButtonProps {
  userId: string;
  sessionId: string;
  repId: string;
  /**
   * Invoked after the flag is written and a weight recommendation is
   * emitted. Host can use this to push a toast, trigger haptics, or
   * call into the session runner to apply the recommended delta.
   */
  onFlagged?: (
    flag: PainFlag,
    recommendation: ReturnType<typeof adjustNextSetWeight>,
  ) => void;
  testID?: string;
}

// =============================================================================
// Component
// =============================================================================

const LOCATIONS: PainLocation[] = [
  'lower_back',
  'upper_back',
  'knee',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'other',
];

const SEVERITIES: PainSeverity[] = [1, 2, 3, 4, 5];

export function RepPainFlagButton({
  userId,
  sessionId,
  repId,
  onFlagged,
  testID = 'rep-pain-flag-button',
}: RepPainFlagButtonProps) {
  const [isOpen, setOpen] = useState(false);
  const [location, setLocation] = useState<PainLocation | null>(null);
  const [severity, setSeverity] = useState<PainSeverity>(2);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setLocation(null);
    setSeverity(2);
    setNotes('');
    setSubmitting(false);
  }, []);

  const open = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const canSubmit = location != null && !submitting;

  const submit = useCallback(async () => {
    if (!location || submitting) return;
    setSubmitting(true);
    try {
      const flag = await flagRepPain(userId, {
        repId,
        sessionId,
        location,
        severity,
        notes: notes.trim() || undefined,
      });
      const recommendation = adjustNextSetWeight(sessionId, severity);
      onFlagged?.(flag, recommendation);
      setOpen(false);
      reset();
    } catch (err) {
      errorWithTs('[RepPainFlagButton] failed to log pain flag', err);
      setSubmitting(false);
    }
  }, [
    location,
    severity,
    notes,
    userId,
    sessionId,
    repId,
    submitting,
    onFlagged,
    reset,
  ]);

  const severityLabel = useMemo(
    () => SEVERITY_LABELS[severity - 1] ?? '',
    [severity],
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Flag pain on this rep"
        accessibilityHint="Opens a form to log pain or injury"
        onPress={open}
        testID={testID}
        style={styles.trigger}
      >
        <Ionicons name="medkit-outline" size={16} color="#FF3B30" />
        <Text style={styles.triggerText}>Flag pain</Text>
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.backdrop} testID={`${testID}-backdrop`}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Log pain</Text>
              <Pressable
                onPress={close}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID={`${testID}-close`}
              >
                <Ionicons name="close" size={22} color="#8E8E93" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.body}>
              <Text style={styles.sectionLabel}>Where?</Text>
              <View style={styles.grid} testID={`${testID}-locations`}>
                {LOCATIONS.map((loc) => {
                  const active = location === loc;
                  return (
                    <Pressable
                      key={loc}
                      onPress={() => setLocation(loc)}
                      accessibilityRole="button"
                      accessibilityLabel={`${PAIN_LOCATION_LABELS[loc]} location`}
                      accessibilityState={{ selected: active }}
                      testID={`${testID}-location-${loc}`}
                      style={[
                        styles.gridItem,
                        active && styles.gridItemActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.gridItemText,
                          active && styles.gridItemTextActive,
                        ]}
                      >
                        {PAIN_LOCATION_LABELS[loc]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>
                Severity: {severity}/5 · {severityLabel}
              </Text>
              <View style={styles.severityRow} testID={`${testID}-severities`}>
                {SEVERITIES.map((s) => {
                  const active = severity === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSeverity(s)}
                      accessibilityRole="button"
                      accessibilityLabel={`Severity ${s}`}
                      accessibilityState={{ selected: active }}
                      testID={`${testID}-severity-${s}`}
                      style={[
                        styles.severityDot,
                        active && styles.severityDotActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.severityText,
                          active && styles.severityTextActive,
                        ]}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>Notes (optional)</Text>
              <TextInput
                value={notes}
                onChangeText={(v) => setNotes(v.slice(0, 500))}
                placeholder="What triggered it? Rep 3 of set 2…"
                placeholderTextColor="#8E8E93"
                multiline
                accessibilityLabel="Notes"
                testID={`${testID}-notes`}
                style={styles.notesInput}
              />
              <Text style={styles.charCount}>{notes.length}/500</Text>
            </ScrollView>

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                onPress={close}
                style={[styles.cta, styles.ctaSecondary]}
                testID={`${testID}-cancel`}
              >
                <Text style={styles.ctaSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Log pain and adjust next set"
                accessibilityState={{ disabled: !canSubmit }}
                disabled={!canSubmit}
                onPress={submit}
                style={[
                  styles.cta,
                  styles.ctaPrimary,
                  !canSubmit && styles.ctaDisabled,
                ]}
                testID={`${testID}-submit`}
              >
                <Text style={styles.ctaPrimaryText}>
                  {submitting ? 'Logging…' : 'Log & adjust next set'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const SEVERITY_LABELS = [
  'twinge',
  'noticeable',
  'uncomfortable',
  'sharp',
  'stop the set',
];

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FF3B3015',
    alignSelf: 'flex-start',
  },
  triggerText: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: '#FF3B30',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    backgroundColor: '#0F2339',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1B2E4A',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Lexend_700Bold',
    color: '#FFFFFF',
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Lexend_500Medium',
    color: '#8E8E93',
    marginTop: 16,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#152C47',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  gridItemActive: {
    backgroundColor: '#4C8CFF25',
    borderColor: '#4C8CFF',
  },
  gridItemText: {
    fontSize: 13,
    fontFamily: 'Lexend_400Regular',
    color: '#D1D5DB',
  },
  gridItemTextActive: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_500Medium',
  },
  severityRow: {
    flexDirection: 'row',
    gap: 10,
  },
  severityDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#152C47',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  severityDotActive: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  severityText: {
    fontSize: 16,
    fontFamily: 'Lexend_500Medium',
    color: '#D1D5DB',
  },
  severityTextActive: {
    color: '#FFFFFF',
    fontFamily: 'Lexend_700Bold',
  },
  notesInput: {
    minHeight: 80,
    backgroundColor: '#152C47',
    borderWidth: 1,
    borderColor: '#1B2E4A',
    borderRadius: 12,
    padding: 12,
    color: '#FFFFFF',
    fontFamily: 'Lexend_400Regular',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  charCount: {
    marginTop: 4,
    textAlign: 'right',
    fontSize: 11,
    fontFamily: 'Lexend_400Regular',
    color: '#8E8E93',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  cta: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaPrimary: {
    backgroundColor: '#4C8CFF',
  },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Lexend_700Bold',
  },
  ctaSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1B2E4A',
  },
  ctaSecondaryText: {
    color: '#D1D5DB',
    fontSize: 15,
    fontFamily: 'Lexend_500Medium',
  },
  ctaDisabled: {
    opacity: 0.5,
  },
});

export default RepPainFlagButton;
