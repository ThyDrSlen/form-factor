// Local shim for `expo-health` to avoid runtime and config plugin errors.
// Matches the public API declared in types/expo-health.d.ts

export enum HealthDataType {
  HEART_RATE = 'heartRate',
  ACTIVE_ENERGY_BURNED = 'activeEnergyBurned',
  BASAL_ENERGY_BURNED = 'basalEnergyBurned',
  STEPS = 'stepCount',
  BODY_MASS = 'bodyMass',
  HEIGHT = 'height',
  WORKOUTS = 'workouts',
  BIOLOGICAL_SEX = 'biologicalSex',
  DATE_OF_BIRTH = 'dateOfBirth',
  RESPIRATORY_RATE = 'respiratoryRate',
  WALKING_HEART_RATE_AVERAGE = 'walkingHeartRateAverage',
  DISTANCE_WALKING_RUNNING = 'distanceWalkingRunning',
  DISTANCE_CYCLING = 'distanceCycling',
  DISTANCE_SWIMMING = 'distanceSwimming',
  WORKOUT_ROUTE = 'workoutRoute',
  RESTING_HEART_RATE = 'restingHeartRate',
  HEART_RATE_VARIABILITY = 'heartRateVariability',
  VO2_MAX = 'vo2Max',
  SLEEP_ANALYSIS = 'sleepAnalysis',
}

export type PermissionSet = {
  read?: HealthDataType[];
  write?: HealthDataType[];
};

export async function isAvailableAsync(): Promise<boolean> {
  // Until a real implementation is wired, report availability based on platform features if needed.
  // Keep this conservative to avoid misleading app state.
  return false;
}

export async function getPermissionsAsync(): Promise<Required<PermissionSet>> {
  return {
    read: [],
    write: [],
  };
}

export async function requestPermissionsAsync(_params: PermissionSet): Promise<void> {
  // No-op: pretend request completed.
}
