module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo', 'nativewind/babel'],
    plugins: [
      ['@babel/plugin-transform-runtime', {
        helpers: true,
        regenerator: true,
      }],
      ['module-resolver', {
        root: ['./'],
        alias: {
          '@': './',
        },
      }],
      'react-native-reanimated/plugin',
    ],
  };
};
