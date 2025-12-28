import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

export type HealthKitAuthorizationSummary = {
  hasReadPermission: boolean;
  hasSharePermission: boolean;
};

export type NativeHealthKitModule = {
  isAvailable: () => boolean;
  getAuthorizationStatus: (readTypes: string[], writeTypes: string[]) => HealthKitAuthorizationSummary;
  requestAuthorization: (readTypes: string[], writeTypes: string[]) => Promise<HealthKitAuthorizationSummary>;
  getBiologicalSex: () => Promise<string | null>;
  getDateOfBirth: () => Promise<{ birthDate: string | null; age: number | null }>;
  getQuantitySamples: (
    type: string,
    startDate: string,
    endDate: string,
    unit: string,
    limit?: number | null,
    ascending?: boolean | null
  ) => Promise<Array<{ value: number; startDate: string; endDate: string }>>;
  getLatestQuantitySample: (type: string, unit: string) => Promise<{ value: number; startDate: string; endDate: string } | null>;
  getDailySumSamples: (
    type: string,
    startDate: string,
    endDate: string,
    unit: string
  ) => Promise<Array<{ value: number; startDate: string; endDate: string }>>;
};

let cachedNative: NativeHealthKitModule | null = null;
let loggedFailure = false;

export function getNativeHealthKit(): NativeHealthKitModule | null {
  if (cachedNative) {
    return cachedNative;
  }
  if (Platform.OS !== 'ios') {
    return null;
  }
  try {
    cachedNative = requireNativeModule<NativeHealthKitModule>('FFHealthKit');
  } catch (error) {
    if (!loggedFailure) {
      console.error('[HealthKit] Failed to load FFHealthKit module', error);
      loggedFailure = true;
    }
    cachedNative = null;
  }
  return cachedNative;
}
