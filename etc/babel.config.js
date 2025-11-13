const { resolve } = require('path');

module.exports = function (api) {
  api.cache(true);
  const projectRoot = resolve(__dirname, '..');
  return {
    presets: ['babel-preset-expo', 'nativewind/babel'],
    plugins: [
      ['@babel/plugin-transform-runtime', {
        helpers: true,
        regenerator: true,
      }],
      ['module-resolver', {
        root: [projectRoot],
        alias: {
          '@': projectRoot,
        },
      }],
      'react-native-reanimated/plugin',
    ],
  };
};

