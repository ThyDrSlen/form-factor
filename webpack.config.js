const { resolve } = require('path');
const createExpoWebpackConfigAsync = require('@expo/webpack-config');

module.exports = async function(env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  config.resolve.alias = {
    ...config.resolve.alias,
    tslib: resolve(__dirname, 'tslib-proper-shim.js'),
    'tslib/modules': resolve(__dirname, 'tslib-proper-shim.js'),
    'tslib/modules/index.js': resolve(__dirname, 'tslib-proper-shim.js'),
    'tslib/tslib.es6.js': resolve(__dirname, 'tslib-proper-shim.js'),
  };
  return config;
};
