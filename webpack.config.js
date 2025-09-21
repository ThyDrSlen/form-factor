const { resolve } = require('path');
const createExpoWebpackConfigAsync = require('@expo/webpack-config');

module.exports = async function(env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  config.resolve.alias = {
    ...config.resolve.alias,
    tslib: resolve(__dirname, 'shim-tslib.js'),
    'tslib/modules': resolve(__dirname, 'shim-tslib.js'),
    'tslib/modules/index.js': resolve(__dirname, 'shim-tslib.js'),
  };
  return config;
};
