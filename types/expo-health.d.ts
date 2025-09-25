declare module 'expo-health' {
  export enum HealthDataType {
    HEART_RATE = 'heartRate',
    ACTIVE_ENERGY_BURNED = 'activeEnergyBurned',
    BASAL_ENERGY_BURNED = 'basalEnergyBurned',
    STEPS = 'stepCount',
    BODY_MASS = 'bodyMass',
    HEIGHT = 'height',
    WORKOUTS = 'workouts',
  }

  export type PermissionSet = {
    read?: HealthDataType[];
    write?: HealthDataType[];
  };

  export function isAvailableAsync(): Promise<boolean>;
  export function getPermissionsAsync(): Promise<Required<PermissionSet>>;
  export function requestPermissionsAsync(params: PermissionSet): Promise<void>;
}
