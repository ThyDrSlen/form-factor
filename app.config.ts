import type { ConfigContext, ExpoConfig } from 'expo/config';

// Expo automatically merges app.json, so we just need to add extras
export default function ({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: config.name ?? 'form-factor-eas',
    slug: config.slug ?? 'form-factor-eas',
    extra: {
      ...(config.extra ?? {}),
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
  };
}
