import '@testing-library/jest-native/extend-expect';

// Set environment variables for tests
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// Mock expo-constants
jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-key',
    },
  },
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-sqlite for local-db tests
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  SQLiteDatabase: jest.fn(),
}));

// Mock Supabase globally - this must be in setup to ensure it's mocked before any imports
// NOTE: jest.mock is hoisted, so the mockSupabaseAuth object must be defined INSIDE the factory
// or accessed via a module-level variable that's initialized before the factory runs.

const mockSupabaseAuth = {
  getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
  setSession: jest.fn().mockResolvedValue({ error: null }),
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  signOut: jest.fn().mockResolvedValue({ error: null }),
  updateUser: jest.fn(),
  resetPasswordForEmail: jest.fn(),
  onAuthStateChange: jest.fn(() => ({
    data: { subscription: { unsubscribe: jest.fn() } },
  })),
};

// Export for tests to access and configure BEFORE the mock is defined
(global as any).__mockSupabaseAuth = mockSupabaseAuth;

jest.mock('@/lib/supabase', () => {
  // Access the mock via global to avoid hoisting issues
  const auth = (global as any).__mockSupabaseAuth;
  return {
    supabase: {
      auth,
    },
  };
});

// Silence console warnings in tests (optional)
// console.warn = jest.fn();
