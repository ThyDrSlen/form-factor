import type { ConfigContext, ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';
const IS_PREVIEW = process.env.APP_VARIANT === 'preview';

const getUniqueIdentifier = () => {
  if (IS_DEV) return 'com.slenthekid.formfactoreas.dev';
  if (IS_PREVIEW) return 'com.slenthekid.formfactoreas.preview';
  return 'com.slenthekid.formfactoreas';
};

const getAppName = () => {
  return 'formfactoreas';
};

const getScheme = () => {
  return 'formfactoreas';
};

// Expo automatically merges app.json, so we just need to add extras
export default function ({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: getAppName(),
    slug: config.slug ?? 'form-factor-eas',
    scheme: getScheme(),
    ios: {
      ...config.ios,
      bundleIdentifier: getUniqueIdentifier(),
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: 'Form Factor',
      },
    },
    android: {
      ...config.android,
      package: getUniqueIdentifier(),
    },
    extra: {
      ...(config.extra ?? {}),
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: {
        projectId: "7337bf10-81b2-41f2-b8e7-047610a7a7e5"
      },
      appVariant: process.env.APP_VARIANT,
    },
  };
}
