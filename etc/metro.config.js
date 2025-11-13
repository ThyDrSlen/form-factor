const { resolve } = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = (() => {
  const projectRoot = resolve(__dirname, '..');
  const cfg = getDefaultConfig(projectRoot);

  const { resolver } = cfg;

  const tslibShimPath = require.resolve('./tslib-proper-shim.js');

  cfg.resolver = {
    ...resolver,
    sourceExts: [...resolver.sourceExts, 'mjs', 'cjs'],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith('tslib')) {
        return context.resolveRequest(context, tslibShimPath, platform);
      }

      return context.resolveRequest(context, moduleName, platform);
    },
    extraNodeModules: {
      ...(resolver.extraNodeModules || {}),
      '@supabase/node-fetch': require.resolve('@supabase/node-fetch/browser.js'),
      punycode: require.resolve('punycode/punycode.js'),
    },
  };

  return cfg;
})();

module.exports = withNativeWind(config);

