import AppleHealthKit, {
  type HealthKitPermissions as AppleHealthKitPermissions,
  type HealthPermission as AppleHealthPermission,
  type HealthStatusResult,
  HealthStatusCode,
} from 'react-native-health';
import { HealthDataType, HealthKitPermissions, HealthPermissionStatus } from './health-types';

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

function parseStatusResult(result?: HealthStatusResult | null): Pick<HealthPermissionStatus, 'hasReadPermission' | 'hasSharePermission'> {
  if (!result) {
    return { hasReadPermission: false, hasSharePermission: false };
  }

  const hasSharePermission =
    result.permissions.write?.some((status) => status === HealthStatusCode.SharingAuthorized) ?? false;
  const hasReadPermission =
    result.permissions.read?.some((status) => status === HealthStatusCode.SharingAuthorized) ?? false;

  return { hasReadPermission, hasSharePermission };
}

export async function getAvailabilityAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      AppleHealthKit.isAvailable((_error, available) => {
        resolve(Boolean(available));
      });
    } catch (error) {
      resolve(false);
    }
  });
}

export async function getPermissionStatusAsync(
  permissions: HealthKitPermissions
): Promise<HealthPermissionStatus> {
  const isAvailable = await getAvailabilityAsync();
  if (!isAvailable) {
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  const payload = buildPermissionPayload(permissions);

  return new Promise((resolve) => {
    try {
      AppleHealthKit.getAuthStatus(payload, (_error, result) => {
        const { hasReadPermission, hasSharePermission } = parseStatusResult(result);
        resolve(
          buildStatus({
            isAvailable: true,
            isAuthorized: hasReadPermission || hasSharePermission,
            hasReadPermission,
            hasSharePermission,
          })
        );
      });
    } catch (error) {
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
      AppleHealthKit.initHealthKit(payload, (error) => {
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error as Error);
    }
  });
}

export async function requestPermissionsAsync(
  permissions: HealthKitPermissions
): Promise<HealthPermissionStatus> {
  const isAvailable = await getAvailabilityAsync();
  if (!isAvailable) {
    return buildStatus({
      isAvailable: false,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  const payload = buildPermissionPayload(permissions);

  try {
    await initHealthKitAsync(payload);
  } catch (error) {
    return buildStatus({
      isAvailable: true,
      isAuthorized: false,
      hasSharePermission: false,
      hasReadPermission: false,
    });
  }

  return getPermissionStatusAsync(permissions);
}
