import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { errorWithTs } from '@/lib/logger';

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_native',
        location:'native-healthkit.ts:getNativeHealthKit',
        message:'attempt load FFHealthKit',
        data:{ cached:false },
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion
    cachedNative = requireNativeModule<NativeHealthKitModule>('FFHealthKit');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_native',
        location:'native-healthkit.ts:getNativeHealthKit',
        message:'FFHealthKit loaded',
        data:{ loaded:true },
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion
  } catch (error) {
    if (!loggedFailure) {
      errorWithTs('[HealthKit] Failed to load FFHealthKit module', error);
      loggedFailure = true;
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_native',
        location:'native-healthkit.ts:getNativeHealthKit',
        message:'FFHealthKit load failed',
        data:{ error: error instanceof Error ? error.message : String(error) },
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion
    cachedNative = null;
  }
  return cachedNative;
}
