import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

// Expo-compatible polyfills for Hermes
if (Platform.OS !== 'web') {
  // Use React Native's built-in Buffer for base64 operations
  if (typeof global.atob === 'undefined') {
    global.atob = function(str: string) {
      return Buffer.from(str, 'base64').toString('binary');
    };
  }
  
  if (typeof global.btoa === 'undefined') {
    global.btoa = function(str: string) {
      return Buffer.from(str, 'binary').toString('base64');
    };
  }
}

// Validate environment variables
function validateEnvironment() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Constants.expoConfig?.extra?.supabaseAnonKey;

  if (!supabaseUrl) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL. Please check your .env file and ensure it contains:\n' +
      'EXPO_PUBLIC_SUPABASE_URL=your_supabase_url'
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. Please check your .env file and ensure it contains:\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key'
    );
  }

  // Validate URL format
  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error(
      `Invalid EXPO_PUBLIC_SUPABASE_URL format: ${supabaseUrl}\n` +
      'Please ensure it follows the format: https://your-project.supabase.co'
    );
  }

  // Validate anon key format (basic check)
  // Accept both legacy JWT-style anon keys and the newer publishable keys.
  // - Legacy JWT keys often start with 'eyJ' and have 3 dot-separated parts.
  // - New publishable keys may start with prefixes like 'sb_publishable_', 'sb-publishable_', or 'sbp_'.
  const looksLikeJwt = supabaseAnonKey.split('.').length === 3 && supabaseAnonKey.startsWith('eyJ');
  const looksLikePublishable = /^(sbp_|sbpl_|sb[-_]?publishable_)/i.test(supabaseAnonKey);

  if (!(looksLikeJwt || looksLikePublishable)) {
    // Do not throw to allow newer formats moving forward; warn for visibility in dev logs.
    console.warn(
      '[Supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY does not look like a typical JWT or publishable key. Continuing anyway. '
      + 'If auth fails, re-check the key in your Supabase project settings.'
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

// Get validated environment variables
const { supabaseUrl, supabaseAnonKey } = validateEnvironment();

console.log('[Supabase] Initializing client:', {
  url: supabaseUrl,
  platform: Platform.OS,
  hasAsyncStorage: Platform.OS !== 'web',
});

// Create Supabase client with optimized configuration
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Use AsyncStorage only on native platforms; on web, default storage (localStorage) is used.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === 'web', // Only detect session in URL on web
    // Remove processLock as it's not needed for our use case
  },
  // Add global configuration
  global: {
    headers: {
      'X-Client-Info': `fitness-app-${Platform.OS}`,
    },
  },
});

// Log successful initialization
console.log('[Supabase] Client initialized successfully');
