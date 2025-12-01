import AppleHealthKit, {
  type HealthKitPermissions as AppleHealthKitPermissions,
  type HealthPermission as AppleHealthPermission,
  type HealthStatusResult,
} from 'react-native-health';
import { NativeModules, Platform } from 'react-native';
import { HealthDataType, HealthKitPermissions, HealthPermissionStatus } from './health-types';

const TAG = '[HealthKit]';
function hkLog(...args: unknown[]): void {
  console.log(TAG, ...args);
}

function getNativeHealthKitModule(): unknown {
  return (NativeModules as any)?.RNAppleHealthKit ?? (NativeModules as any)?.AppleHealthKit ?? null;
}

function toApplePermissions(types: HealthDataType[]): AppleHealthPermission[] {
  const { Permissions } = AppleHealthKit.Constants;
  const map: Record<HealthDataType, AppleHealthPermission> = {
    heartRate: Permissions.HeartRate,
    activeEnergyBurned: Permissions.ActiveEnergyBurned,
    basalEnergyBurned: Permissions.BasalEnergyBurned,
    stepCount: Permissions.StepCount,
    bodyMass: Permissions.BodyMass,
    height: Permissions.Height,
    workouts: Permissions.Workout,
    biologicalSex: Permissions.BiologicalSex,
    dateOfBirth: Permissions.DateOfBirth,
    respiratoryRate: Permissions.RespiratoryRate,
    walkingHeartRateAverage: Permissions.WalkingHeartRateAverage,
    distanceWalkingRunning: Permissions.DistanceWalkingRunning,
    distanceCycling: Permissions.DistanceCycling,
    distanceSwimming: Permissions.DistanceSwimming,
    workoutRoute: Permissions.WorkoutRoute,
    restingHeartRate: Permissions.RestingHeartRate,
    heartRateVariability: Permissions.HeartRateVariability,
    vo2Max: Permissions.Vo2Max,
    sleepAnalysis: Permissions.SleepAnalysis,
  };

  const uniqueTypes = Array.from(new Set(types));
  return uniqueTypes.map((type) => {
    const permission = map[type];
    if (!permission) {
      throw new Error(`Unsupported HealthDataType: ${type}`);
    }
    return permission;
  });
}

function buildPermissionPayload(permissions: HealthKitPermissions): AppleHealthKitPermissions {
  return {
    permissions: {
      read: toApplePermissions(permissions.read ?? []),
      write: toApplePermissions(permissions.write ?? []),
    },
  };
}

function buildStatus(partial: Omit<HealthPermissionStatus, 'lastCheckedAt'>): HealthPermissionStatus {
  return {
    ...partial,
    lastCheckedAt: Date.now(),
  };
}

// HealthKit bridges sometimes return numeric enums and sometimes strings, so
// normalise both possibilities when checking authorization flags.
function isSharingAuthorized(status: unknown): boolean {
  if (typeof status === 'string') {
    return status === 'SharingAuthorized';
  }
  if (typeof status === 'number') {
    return status === 2; // Matches HealthStatusCode.SharingAuthorized
  }
  return false;
}

function parseStatusResult(result?: HealthStatusResult | null): Pick<HealthPermissionStatus, 'hasReadPermission' | 'hasSharePermission'> {
  if (!result) {
    return { hasReadPermission: false, hasSharePermission: false };
  }

  const hasSharePermission = result.permissions.write?.some(isSharingAuthorized) ?? false;
  const hasReadPermission = result.permissions.read?.some(isSharingAuthorized) ?? false;

  return { hasReadPermission, hasSharePermission };
}

export async function getAvailabilityAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (Platform.OS !== 'ios') {
        hkLog('getAvailabilityAsync: non-iOS platform => unavailable');
        resolve(false);
        return;
      }
      const native = getNativeHealthKitModule() as any;
      hkLog('getAvailabilityAsync: NativeModules.RNAppleHealthKit present =', Boolean(native));
      const hasIsAvailable = typeof (AppleHealthKit as any)?.isAvailable === 'function';
      const hasIsHealthDataAvailable = typeof (AppleHealthKit as any)?.isHealthDataAvailable === 'function';
      hkLog('getAvailabilityAsync: hasIsAvailable =', hasIsAvailable, 'hasIsHealthDataAvailable =', hasIsHealthDataAvailable);

      const onResult = (_error: unknown, available: boolean) => {
        hkLog('isAvailable result =', available);
        resolve(Boolean(available));
      };

      if (hasIsAvailable) {
        hkLog('getAvailabilityAsync: calling AppleHealthKit.isAvailable');
        (AppleHealthKit as any).isAvailable(onResult);
        return;
      }
      if (hasIsHealthDataAvailable) {
        hkLog('getAvailabilityAsync: calling AppleHealthKit.isHealthDataAvailable');
        (AppleHealthKit as any).isHealthDataAvailable(onResult);
        return;
      }
      // Try calling native module directly if JS wrapper methods are missing
      if (native) {
        if (typeof native.isAvailable === 'function') {
          hkLog('getAvailabilityAsync: calling NativeModules.RNAppleHealthKit.isAvailable');
          native.isAvailable(onResult);
          return;
        }
        if (typeof native.isHealthDataAvailable === 'function') {
          hkLog('getAvailabilityAsync: calling NativeModules.RNAppleHealthKit.isHealthDataAvailable');
          native.isHealthDataAvailable(onResult);
          return;
        }
      }
      hkLog('getAvailabilityAsync: no availability API found on AppleHealthKit or native module');
      resolve(false);
    } catch (error) {
      hkLog('getAvailabilityAsync error', error);
      resolve(false);
    }
  });
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

  const payload = buildPermissionPayload(permissions);
  hkLog('getPermissionStatusAsync: calling getAuthStatus with', payload.permissions);
  const native = getNativeHealthKitModule() as any;
  const hasGetAuthStatus = typeof (AppleHealthKit as any)?.getAuthStatus === 'function';
  const hasNativeGetAuthStatus = typeof native?.getAuthStatus === 'function';
  hkLog('getPermissionStatusAsync: hasGetAuthStatus =', hasGetAuthStatus, 'hasNativeGetAuthStatus =', hasNativeGetAuthStatus);

  return new Promise((resolve) => {
    try {
      const handler = (_error: unknown, result: HealthStatusResult | null) => {
        hkLog('getAuthStatus result =', result);
        const { hasReadPermission, hasSharePermission } = parseStatusResult(result ?? undefined);
        hkLog('parsed permissions =>', { hasReadPermission, hasSharePermission });
        resolve(
          buildStatus({
            isAvailable: true,
            isAuthorized: hasReadPermission || hasSharePermission,
            hasReadPermission,
            hasSharePermission,
          })
        );
      };

      if (hasGetAuthStatus) {
        (AppleHealthKit as any).getAuthStatus(payload, handler);
        return;
      }
      if (hasNativeGetAuthStatus) {
        native.getAuthStatus(payload, handler);
        return;
      }
      hkLog('getPermissionStatusAsync: no getAuthStatus method found');
      resolve(
        buildStatus({
          isAvailable: true,
          isAuthorized: false,
          hasReadPermission: false,
          hasSharePermission: false,
        })
      );
    } catch (error) {
      hkLog('getAuthStatus threw error', error);
      resolve(
        buildStatus({
          isAvailable: true,
          isAuthorized: false,
          hasReadPermission: false,
          hasSharePermission: false,
        })
      );
    }
  });
}

function initHealthKitAsync(payload: AppleHealthKitPermissions): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      hkLog('initHealthKit: requesting with', payload.permissions);
      const module = (AppleHealthKit as any)?.initHealthKit ? (AppleHealthKit as any) : (getNativeHealthKitModule() as any);
      if (typeof module?.initHealthKit !== 'function') {
        hkLog('initHealthKit: no initHealthKit function on module', module);
        reject(new Error('HealthKit init function not available'));
        return;
      }
      module.initHealthKit(payload, (error: string | null) => {
        if (error) {
          hkLog('initHealthKit error:', error);
          reject(new Error(error));
          return;
        }
        hkLog('initHealthKit success');
        resolve();
      });
    } catch (error) {
      hkLog('initHealthKit threw error', error);
      reject(error as Error);
    }
  });
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

  const payload = buildPermissionPayload(permissions);

  try {
    hkLog('requestPermissionsAsync: initHealthKit start');
    await initHealthKitAsync(payload);
    hkLog('requestPermissionsAsync: initHealthKit done, fetching status');
  } catch (error) {
    hkLog('requestPermissionsAsync: initHealthKit failed', error);
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  const status = await getPermissionStatusAsync(permissions);
  hkLog('requestPermissionsAsync: final status', status);
  return status;
}
