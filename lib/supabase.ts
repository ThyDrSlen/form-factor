import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import { logWithTs, warnWithTs } from '@/lib/logger';

const DEV = __DEV__;

// #region agent log
fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
    sessionId:'debug-session',
    runId:'run1',
    hypothesisId:'H_entry_supabase',
    location:'lib/supabase.ts:module',
    message:'supabase module loaded',
    data:{ platform:Platform.OS },
    timestamp:Date.now()
  })
}).catch(()=>{});
// #endregion

// Pure JavaScript base64 implementation for Hermes (no Buffer dependency)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function safeAtob(str: string): string {
  // Normalize base64url -> base64 and strip whitespace.
  // Many JWT-related values are base64url-encoded (use '-' and '_' and omit padding).
  let cleaned = str.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = cleaned.length % 4;
  if (remainder === 2) cleaned += '==';
  else if (remainder === 3) cleaned += '=';
  else if (remainder === 1) throw new Error('Invalid base64 string');
  let output = '';
  let buffer = 0;
  let bits = 0;
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char === '=') break;
    
    const index = BASE64_CHARS.indexOf(char);
    if (index === -1) throw new Error('Invalid base64 string');
    
    buffer = (buffer << 6) | index;
    bits += 6;
    
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  
  return output;
}

function safeBtoa(str: string): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  
  for (let i = 0; i < str.length; i++) {
    buffer = (buffer << 8) | str.charCodeAt(i);
    bits += 8;
    
    while (bits >= 6) {
      bits -= 6;
      output += BASE64_CHARS[(buffer >> bits) & 0x3f];
    }
  }
  
  if (bits > 0) {
    output += BASE64_CHARS[(buffer << (6 - bits)) & 0x3f];
  }
  
  // Add padding
  while (output.length % 4 !== 0) {
    output += '=';
  }
  
  return output;
}

// Expo-compatible polyfills for Hermes (using pure JS, not Buffer)
if (Platform.OS !== 'web') {
  if (typeof global.atob === 'undefined') {
    global.atob = safeAtob;
  }
  
  if (typeof global.btoa === 'undefined') {
    global.btoa = safeBtoa;
  }
}

// Validate environment variables
function validateEnvironment() {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      sessionId:'debug-session',
      runId:'run1',
      hypothesisId:'H_env',
      location:'lib/supabase.ts:validateEnvironment',
      message:'validateEnvironment start',
      data:{ hasUrl:!!(process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl), hasAnon:!!(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Constants.expoConfig?.extra?.supabaseAnonKey) },
      timestamp:Date.now()
    })
  }).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_env',
        location:'lib/supabase.ts:validateEnvironment',
        message:'invalid supabase url',
        data:{ supabaseUrl },
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion
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
    if (DEV) {
      warnWithTs(
        '[Supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY does not look like a typical JWT or publishable key. Continuing anyway. '
        + 'If auth fails, re-check the key in your Supabase project settings.'
      );
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sessionId:'debug-session',
        runId:'run1',
        hypothesisId:'H_env',
        location:'lib/supabase.ts:validateEnvironment',
        message:'anon key atypical format',
        data:{ looksLikeJwt, looksLikePublishable },
        timestamp:Date.now()
      })
    }).catch(()=>{});
    // #endregion
  }

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/8fe7b778-fa45-419b-917f-0b8c3047244f',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      sessionId:'debug-session',
      runId:'run1',
      hypothesisId:'H_env',
      location:'lib/supabase.ts:validateEnvironment',
      message:'validateEnvironment ok',
      data:{ supabaseUrlLength:supabaseUrl.length, anonKeyLength:supabaseAnonKey.length },
      timestamp:Date.now()
    })
  }).catch(()=>{});
  // #endregion
  return { supabaseUrl, supabaseAnonKey };
}

// Get validated environment variables
const { supabaseUrl, supabaseAnonKey } = validateEnvironment();

if (DEV) {
  logWithTs('[Supabase] Initializing client:', {
    url: supabaseUrl,
    platform: Platform.OS,
    hasAsyncStorage: Platform.OS !== 'web',
  });
}

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

// Log successful initialization (dev only)
if (DEV) {
  logWithTs('[Supabase] Client initialized successfully');
}
