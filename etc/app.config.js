// Expo config lives here; root app.config.ts simply re-exports this.
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

const baseConfig = {
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    enabled: false,
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/7337bf10-81b2-41f2-b8e7-047610a7a7e5',
  },
  name: 'Form Factor',
  jsEngine: 'hermes',
  slug: 'form-factor-eas',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'formfactoreas',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  plugins: [
    'expo-router',
    'expo-web-browser',
    'react-native-vision-camera',
    [
      'react-native-health',
      {
        healthSharePermission: 'We read steps, heart rate (including resting and variability), VO2 Max, sleep, respiratory rate, walking HR, cardio metrics, and sex/birth year to surface recovery and training insights.',
        healthUpdatePermission: 'We write selected health metrics only when you explicitly enable it.',
        isClinicalDataEnabled: true,
        healthClinicalDescription: 'We access clinical health records (e.g., labs and immunizations) to enhance your health insights.',
      },
    ],
    'expo-font',
    './plugins/withDisableAssetThinning.js',
    [
      'expo-video',
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
  ],
  android: {
    package: 'com.slenthekid.formfactoreas',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'formfactoreas',
          },
          {
            scheme: 'https',
            host: 'nxywytufzdgzcizmpvbd.supabase.co',
            pathPrefix: '/auth/v1/callback',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    edgeToEdgeEnabled: true,
    permissions: ['android.permission.CAMERA'],
  },
  ios: {
    bundleIdentifier: 'com.slenthekid.formfactoreas',
    supportsTablet: true,
    icon: './assets/images/ff-logo.png',
    // buildNumber is managed remotely via appVersionSource: "remote" in eas.json
    appleTeamId: 'NCTLNFGC6G',
    infoPlist: {
      NSHealthShareUsageDescription: 'This app reads steps, heart rate (resting and variability), VO2 Max, sleep, respiratory rate, walking HR, cardio metrics, and sex/birth year to tailor recovery and training insights.',
      NSHealthUpdateUsageDescription: 'This app writes health data to record your activity.',
      NSCameraUsageDescription: 'We need camera access to scan your form and provide skeleton tracking.',
      NSMicrophoneUsageDescription: 'Optional: for recording workout videos',
      NSLocationWhenInUseUsageDescription: 'This app does not use your location, but it is required by Apple Health for workout routes.',
      WKCompanionAppBundleIdentifier: 'com.slenthekid.formfactoreas',
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      'com.apple.developer.healthkit': true,
    },
  },
  web: {
    bundler: 'metro',
    output: 'static',
  },
  assetBundlePatterns: ['assets/**', '**/*.{png,jpg,jpeg,svg,ttf,otf}'],
  owner: 'slenthekid',
  extra: {
    router: {},
    eas: {
      projectId: '7337bf10-81b2-41f2-b8e7-047610a7a7e5',
    },
  },
};

module.exports = function ({ config }) {
  const mergedConfig = {
    ...baseConfig,
    ...config,
    ios: {
      ...baseConfig.ios,
      ...config.ios,
      infoPlist: {
        ...baseConfig.ios?.infoPlist,
        ...config.ios?.infoPlist,
      },
      entitlements: {
        ...baseConfig.ios?.entitlements,
        ...config.ios?.entitlements,
      },
    },
    android: {
      ...baseConfig.android,
      ...config.android,
    },
    updates: {
      ...baseConfig.updates,
      ...config.updates,
    },
    web: {
      ...baseConfig.web,
      ...config.web,
    },
    extra: {
      ...baseConfig.extra,
      ...config.extra,
      eas: {
        ...baseConfig.extra?.eas,
        ...config.extra?.eas,
      },
      router: {
        ...baseConfig.extra?.router,
        ...config.extra?.router,
      },
    },
  };

  return {
    ...mergedConfig,
    name: getAppName(),
    slug: mergedConfig.slug ?? 'form-factor-eas',
    scheme: getScheme(),
    ios: {
      ...mergedConfig.ios,
      bundleIdentifier: getUniqueIdentifier(),
      infoPlist: {
        ...mergedConfig.ios?.infoPlist,
        CFBundleDisplayName: 'Form Factor',
      },
    },
    android: {
      ...mergedConfig.android,
      package: getUniqueIdentifier(),
    },
    extra: {
      ...mergedConfig.extra,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: mergedConfig.extra?.eas,
      appVariant: process.env.APP_VARIANT,
    },
  };
};
