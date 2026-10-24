import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useNetwork } from '@/contexts/NetworkContext';
import { isCloudCoachReachable } from '@/lib/services/coach-cloud-provider';
import { tabColors } from '@/styles/tabs/_tab-theme';

interface CoachAvailabilityBannerProps {
  /**
   * Optional override — when omitted the banner reads NetworkContext
   * directly. Injected by tests so we don't have to wrap every case in a
   * provider tree.
   */
  isOnlineOverride?: boolean;
  testID?: string;
  /**
   * Called when the user taps the "Got it" dismiss CTA. The banner hides
   * locally; parents that want to suppress future renders within a session
   * can track dismissal state themselves.
   */
  onDismiss?: () => void;
}

/**
 * Offline-awareness banner for coach surfaces (#557 finding B4). Rendered
 * when the cloud coach can't be reached so the user understands why a
 * fresh coach reply isn't coming, without making it look broken. Copy is
 * deliberately reassuring: form calibration + on-device features keep
 * working even when cloud is unreachable.
 */
export function CoachAvailabilityBanner({
  isOnlineOverride,
  testID,
  onDismiss,
}: CoachAvailabilityBannerProps): React.ReactElement | null {
  const network = useNetwork();
  const isOnline =
    typeof isOnlineOverride === 'boolean' ? isOnlineOverride : network.isOnline;
  const reachable = isCloudCoachReachable({ isOnline });
  const [dismissed, setDismissed] = useState(false);

  // When cloud coach IS reachable the banner has no job, so render nothing.
  // When the user dismissed it in this mount, keep it hidden until remount.
  if (reachable || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLabel="Coach offline — calibration still works"
      testID={testID ?? 'coach-availability-banner'}
    >
      <Ionicons
        name="cloud-offline-outline"
        size={18}
        color="#F59E0B"
        style={styles.icon}
      />
      <View style={styles.textColumn}>
        <Text style={styles.title}>Coach offline</Text>
        <Text style={styles.body}>calibration still works</Text>
      </View>
      <TouchableOpacity
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss coach offline banner"
        testID={`${testID ?? 'coach-availability-banner'}-dismiss`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.cta}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  icon: {
    marginRight: 2,
  },
  textColumn: {
    flex: 1,
    flexDirection: 'column',
  },
  title: {
    fontSize: 13,
    fontFamily: 'Lexend_700Bold',
    color: '#F59E0B',
  },
  body: {
    fontSize: 12,
    color: tabColors.textSecondary,
    marginTop: 2,
  },
  cta: {
    fontSize: 12,
    fontFamily: 'Lexend_700Bold',
    color: tabColors.accent,
    paddingHorizontal: 6,
  },
});

export default CoachAvailabilityBanner;
