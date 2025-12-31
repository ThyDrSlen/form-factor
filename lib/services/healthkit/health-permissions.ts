import { Platform } from 'react-native';
import { HealthKitPermissions, HealthPermissionStatus } from './health-types';
import { getNativeHealthKit } from './native-healthkit';

const TAG = '[HealthKit]';
function hkLog(...args: unknown[]): void {
  console.log(TAG, ...args);
}

function buildStatus(partial: Omit<HealthPermissionStatus, 'lastCheckedAt'>): HealthPermissionStatus {
  return {
    ...partial,
    lastCheckedAt: Date.now(),
  };
}

export async function getAvailabilityAsync(): Promise<boolean> {
  try {
    if (Platform.OS !== 'ios') {
      hkLog('getAvailabilityAsync: non-iOS platform => unavailable');
      return false;
    }
    const native = getNativeHealthKit();
    if (!native?.isAvailable) {
      hkLog('getAvailabilityAsync: FFHealthKit module not available');
      return false;
    }
    const available = native.isAvailable();
    hkLog('getAvailabilityAsync: isAvailable =', available);
    return Boolean(available);
  } catch (error) {
    hkLog('getAvailabilityAsync error', error);
    return false;
  }
}

export async function getPermissionStatusAsync(
  permissions: HealthKitPermissions
): Promise<HealthPermissionStatus> {
  if (Platform.OS !== 'ios') {
    hkLog('getPermissionStatusAsync: non-iOS platform');
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }
  const isAvailable = await getAvailabilityAsync();
  if (!isAvailable) {
    hkLog('getPermissionStatusAsync: not available');
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  const native = getNativeHealthKit();
  if (!native?.getAuthorizationStatus) {
    hkLog('getPermissionStatusAsync: FFHealthKit module missing');
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  try {
    hkLog('getPermissionStatusAsync: calling getAuthorizationStatus');
    const summary = native.getAuthorizationStatus(permissions.read ?? [], permissions.write ?? []);
    return buildStatus({
      isAvailable: true,
      isAuthorized: summary.hasReadPermission || summary.hasSharePermission,
      hasReadPermission: summary.hasReadPermission,
      hasSharePermission: summary.hasSharePermission,
    });
  } catch (error) {
    hkLog('getPermissionStatusAsync: getAuthorizationStatus error', error);
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }
}

export async function requestPermissionsAsync(
  permissions: HealthKitPermissions
): Promise<HealthPermissionStatus> {
  if (Platform.OS !== 'ios') {
    hkLog('requestPermissionsAsync: non-iOS platform');
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }
  const isAvailable = await getAvailabilityAsync();
  if (!isAvailable) {
    hkLog('requestPermissionsAsync: not available');
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  const native = getNativeHealthKit();
  if (!native?.requestAuthorization) {
    hkLog('requestPermissionsAsync: FFHealthKit module missing');
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  try {
    hkLog('requestPermissionsAsync: requestAuthorization start');
    const summary = await native.requestAuthorization(permissions.read ?? [], permissions.write ?? []);
    const status = buildStatus({
      isAvailable: true,
      isAuthorized: summary.hasReadPermission || summary.hasSharePermission,
      hasSharePermission: summary.hasSharePermission,
      hasReadPermission: summary.hasReadPermission,
    });
    hkLog('requestPermissionsAsync: final status', status);
    return status;
  } catch (error) {
    hkLog('requestPermissionsAsync: requestAuthorization failed', error);
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }
}
