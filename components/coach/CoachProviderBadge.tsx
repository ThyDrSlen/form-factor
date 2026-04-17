import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CoachProvider } from '@/lib/services/coach-provider-types';
import { tabColors } from '@/styles/tabs/_tab-theme';

interface CoachProviderBadgeProps {
  provider: CoachProvider;
  testID?: string;
}

interface BadgeVisual {
  label: string;
  a11yLabel: string;
  background: string;
  border: string;
  text: string;
}

const GOOGLE_BLUE = '#4285F4';

function getVisual(provider: CoachProvider): BadgeVisual {
  switch (provider) {
    case 'openai':
      return {
        label: 'GPT',
        a11yLabel: 'Response from GPT',
        background: 'rgba(154, 172, 209, 0.12)',
        border: 'rgba(154, 172, 209, 0.3)',
        text: tabColors.textSecondary,
      };
    case 'gemma-cloud':
      return {
        label: 'Gemma',
        a11yLabel: 'Response from Gemma by Google',
        background: 'rgba(66, 133, 244, 0.16)',
        border: `${GOOGLE_BLUE}55`,
        text: GOOGLE_BLUE,
      };
    case 'gemma-on-device':
      return {
        label: 'Gemma • on device',
        a11yLabel: 'Response from Gemma running on this device',
        background: 'rgba(66, 133, 244, 0.1)',
        border: `${GOOGLE_BLUE}44`,
        text: GOOGLE_BLUE,
      };
    case 'local-fallback':
      return {
        label: 'Local fallback',
        a11yLabel: 'Response from local fallback — network unavailable',
        background: 'rgba(245, 158, 11, 0.16)',
        border: 'rgba(245, 158, 11, 0.45)',
        text: '#F59E0B',
      };
    case 'cached':
      return {
        label: 'From cache',
        a11yLabel: 'Cached response — not a new call to the coach',
        background: 'rgba(154, 172, 209, 0.08)',
        border: 'rgba(154, 172, 209, 0.25)',
        text: tabColors.textSecondary,
      };
    default:
      return {
        label: 'Coach',
        a11yLabel: 'Response from Coach',
        background: 'rgba(154, 172, 209, 0.12)',
        border: 'rgba(154, 172, 209, 0.3)',
        text: tabColors.textSecondary,
      };
  }
}

export function CoachProviderBadge({
  provider,
  testID,
}: CoachProviderBadgeProps): React.ReactElement {
  const visual = getVisual(provider);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: visual.background, borderColor: visual.border },
      ]}
      accessibilityRole="text"
      accessibilityLabel={visual.a11yLabel}
      testID={testID ?? `coach-provider-badge-${provider}`}
    >
      <Text style={[styles.label, { color: visual.text }]}>{visual.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Lexend_700Bold',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

export default CoachProviderBadge;
