// HealthKit types and shared interfaces
// We keep our own app-level enums and map them to expo-health at runtime

export interface HealthKitPermissions {
  read: HealthDataType[];
  write: HealthDataType[];
}

export type HealthDataType =
  | 'heartRate'
  | 'activeEnergyBurned'
  | 'basalEnergyBurned'
  | 'stepCount'
  | 'bodyMass'
  | 'height'
  | 'workouts';

export interface HealthPermissionStatus {
  isAvailable: boolean;
  isAuthorized: boolean;
  hasSharePermission: boolean; // write
  hasReadPermission: boolean; // read
  lastCheckedAt?: number;
}

export interface HealthWorkoutMetadata {
  exercises?: string[];
  totalVolume?: number;
  averageHeartRate?: number;
}

export interface HealthWorkout {
  workoutActivityType: number; // HKWorkoutActivityType; use numeric to avoid enum import
  startDate: Date;
  endDate: Date;
  duration: number; // seconds
  totalEnergyBurned?: number; // kcal
  totalDistance?: number; // meters
  metadata?: HealthWorkoutMetadata;
}

export interface QuantitySample {
  startDate: Date;
  endDate: Date;
  unit: string;
  value: number;
}
