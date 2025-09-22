const { getDefaultConfig } = require('expo/metro-config');

const config = (() => {
  const cfg = getDefaultConfig(__dirname);

  const { resolver } = cfg;

  // The path to our bulletproof, self-contained tslib shim
  const tslibShimPath = require.resolve('./tslib-proper-shim.js');

  cfg.resolver = {
    ...resolver,
    sourceExts: [...resolver.sourceExts, 'mjs', 'cjs'],

    // Use resolveRequest to intercept ALL module requests.
    // This is the most powerful and reliable way to alias modules.
    resolveRequest: (context, moduleName, platform) => {
      // Check if the requested module is tslib or any of its sub-paths.
      if (moduleName.startsWith('tslib')) {
        // If it is, force it to resolve to our self-contained shim.
        return context.resolveRequest(context, tslibShimPath, platform);
      }

      // For all other modules, use the default resolver.
      return context.resolveRequest(context, moduleName, platform);
    },

    // Keep other necessary overrides
    extraNodeModules: {
      ...(resolver.extraNodeModules || {}),
      '@supabase/node-fetch': require.resolve('@supabase/node-fetch/browser.js'),
      punycode: require.resolve('punycode/punycode.js'),
    },
  };

  return cfg;
})();

module.exports = config;

