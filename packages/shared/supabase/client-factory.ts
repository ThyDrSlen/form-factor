/**
 * Supabase Client Factory
 *
 * Platform-agnostic factory for creating Supabase clients.
 * - Expo passes AsyncStorage as the storage adapter
 * - Next.js passes cookie-based storage via @supabase/ssr
 * - Tests can pass an in-memory adapter
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface StorageAdapter {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface ClientFactoryConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage?: StorageAdapter;
  persistSession?: boolean;
  autoRefreshToken?: boolean;
  detectSessionInUrl?: boolean;
  globalHeaders?: Record<string, string>;
}

export function createSupabaseClient(config: ClientFactoryConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      ...(config.storage ? { storage: config.storage } : {}),
      persistSession: config.persistSession ?? true,
      autoRefreshToken: config.autoRefreshToken ?? true,
      detectSessionInUrl: config.detectSessionInUrl ?? false,
    },
    global: {
      headers: config.globalHeaders ?? {},
    },
  });
}

export type { SupabaseClient } from '@supabase/supabase-js';
