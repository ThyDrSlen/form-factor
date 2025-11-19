const { resolve } = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = (() => {
  const projectRoot = resolve(__dirname, '..');
  const cfg = getDefaultConfig(projectRoot);

  const { resolver } = cfg;

  cfg.resolver = {
    ...resolver,
    sourceExts: [...resolver.sourceExts, 'mjs', 'cjs'],
  };

  return cfg;
})();

module.exports = withNativeWind(config, { input: './app/global.css' });

