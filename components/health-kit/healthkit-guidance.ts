import { Platform } from 'react-native';
import type { HealthPermissionStatus } from '@/lib/services/healthkit';

export interface HealthKitGuidance {
  shouldRenderCard: boolean;
  headline: string;
  description: string;
  primaryCtaLabel: string;
  primaryDisabled: boolean;
  showSettingsShortcut: boolean;
  settingsCtaLabel: string;
  footnote?: string;
}

interface GuidanceInput {
  status: HealthPermissionStatus | null;
  isLoading: boolean;
}

const DEFAULT_GUIDANCE: HealthKitGuidance = {
  shouldRenderCard: false,
  headline: '',
  description: '',
  primaryCtaLabel: 'Enable Health Access',
  primaryDisabled: false,
  showSettingsShortcut: false,
  settingsCtaLabel: 'Open iOS Settings',
  footnote: undefined,
};

export function getHealthKitGuidance({ status, isLoading }: GuidanceInput): HealthKitGuidance {
  const isIOS = Platform.OS === 'ios';
  if (!isIOS) {
    return DEFAULT_GUIDANCE;
  }

  if (!status) {
    return {
      shouldRenderCard: true,
      headline: 'Connect to Apple Health',
      description: 'Enable Health permissions to sync steps, heart rate, and other activity metrics.',
      primaryCtaLabel: 'Enable Health Access',
      primaryDisabled: isLoading,
      showSettingsShortcut: false,
      settingsCtaLabel: 'Open iOS Settings',
      footnote: undefined,
    };
  }

  if (!status.isAvailable) {
    return {
      shouldRenderCard: true,
      headline: 'Apple Health Unavailable',
      description: 'Install a Dev Client build on an iPhone with Apple Health enabled to connect your metrics.',
      primaryCtaLabel: 'Enable Health Access',
      primaryDisabled: true,
      showSettingsShortcut: false,
      settingsCtaLabel: 'Open iOS Settings',
      footnote: 'Rebuild the app with HealthKit enabled, then reopen to try again.',
    };
  }

  if (status.hasReadPermission) {
    return DEFAULT_GUIDANCE;
  }

  const hasPromptedBefore = Boolean(status.lastCheckedAt);
  const description = hasPromptedBefore
    ? 'Health permissions are currently disabled. Re-enable access so we can display your latest metrics.'
    : 'Enable Health permissions to start syncing steps, workouts, and heart data from Apple Health.';

  const footnote = hasPromptedBefore
    ? 'After enabling in Settings, return to the app and your metrics will refresh automatically.'
    : undefined;

  return {
    shouldRenderCard: true,
    headline: hasPromptedBefore ? 'Enable Health Permissions' : 'Connect to Apple Health',
    description,
    primaryCtaLabel: 'Enable Health Access',
    primaryDisabled: isLoading,
    showSettingsShortcut: hasPromptedBefore,
    settingsCtaLabel: 'Open iOS Settings',
    footnote,
  };
}
