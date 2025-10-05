/**
 * Platform Utilities
 * 
 * Helper functions for handling platform-specific functionality
 */

import { Platform } from 'react-native';

/**
 * Check if the current platform supports native iOS features
 */
export function isIOS(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Check if the current platform is web
 */
export function isWeb(): boolean {
  return Platform.OS === 'web';
}

/**
 * Check if the current platform is Android
 */
export function isAndroid(): boolean {
  return Platform.OS === 'android';
}

/**
 * Check if the current platform is native (iOS or Android)
 */
export function isNative(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Get a platform-specific value
 * 
 * @example
 * const value = getPlatformValue({
 *   ios: 'iOS value',
 *   android: 'Android value',
 *   web: 'Web value',
 *   default: 'Fallback value'
 * });
 */
export function getPlatformValue<T>(values: {
  ios?: T;
  android?: T;
  web?: T;
  native?: T;
  default: T;
}): T {
  if (Platform.OS === 'ios' && values.ios !== undefined) {
    return values.ios;
  }
  if (Platform.OS === 'android' && values.android !== undefined) {
    return values.android;
  }
  if (Platform.OS === 'web' && values.web !== undefined) {
    return values.web;
  }
  if (isNative() && values.native !== undefined) {
    return values.native;
  }
  return values.default;
}

/**
 * Check if a native feature is available based on platform and optional condition
 * 
 * @param platform - Required platform ('ios', 'android', 'native')
 * @param condition - Optional additional condition (e.g., module availability check)
 * 
 * @example
 * const hasARKit = isFeatureAvailable('ios', BodyTracker.isSupported());
 * const hasHealthKit = isFeatureAvailable('ios');
 */
export function isFeatureAvailable(
  platform: 'ios' | 'android' | 'native',
  condition: boolean = true
): boolean {
  const platformMatches = 
    platform === 'native' 
      ? isNative()
      : Platform.OS === platform;
  
  return platformMatches && condition;
}

/**
 * Execute a function only on a specific platform
 * 
 * @example
 * runOnPlatform('ios', () => {
 *   BodyTracker.startTracking();
 * });
 */
export function runOnPlatform(
  platform: 'ios' | 'android' | 'web' | 'native',
  fn: () => void
): void {
  const shouldRun = 
    platform === 'native' 
      ? isNative()
      : Platform.OS === platform;
  
  if (shouldRun) {
    fn();
  }
}

/**
 * Get platform display name
 */
export function getPlatformName(): string {
  return getPlatformValue({
    ios: 'iOS',
    android: 'Android',
    web: 'Web',
    default: 'Unknown',
  });
}

