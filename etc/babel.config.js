module.exports = function (api) {
  const isTest = api.env('test');
  api.cache(() => isTest);

  const plugins = [
    ['@babel/plugin-transform-runtime', {
      helpers: true,
      regenerator: true,
    }],
    // Disable module-resolver in tests so Jest's moduleNameMapper can handle path aliases
    !isTest && ['module-resolver', {
      root: ['./'],
      alias: {
        '@': './',
      },
      // Support React Native platform-specific extensions
      extensions: [
        '.ios.ts',
        '.ios.tsx',
        '.android.ts',
        '.android.tsx',
        '.native.ts',
        '.native.tsx',
        '.web.ts',
        '.web.tsx',
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.json',
      ],
    }],
    'react-native-reanimated/plugin',
  ].filter(Boolean);

  return {
    presets: ['babel-preset-expo', 'nativewind/babel'],
    plugins,
  };
};
