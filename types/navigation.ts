// This file provides type safety for your routes
export type RootStackParamList = {
  '/(auth)/sign-in': undefined;
  '/(auth)/sign-up': undefined;
  '/(auth)/forgot-password': undefined;
  '/reset-password': undefined;
  '/(tabs)': undefined;
  // Add other routes here as needed
};

// This makes TypeScript know about the types for expo-router
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
