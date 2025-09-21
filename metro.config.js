const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = (() => {
  const cfg = getDefaultConfig(__dirname);

  return {
    ...cfg,
    transformer: {
      ...cfg.transformer,
    },
    resolver: {
      ...cfg.resolver,
      sourceExts: [...cfg.resolver.sourceExts, 'mjs', 'cjs'],


      resolverMainFields: ['react-native', 'browser', 'module', 'main'],
      extraNodeModules: {
        ...(cfg.resolver.extraNodeModules || {}),
        tslib: require.resolve('./shim-tslib.js'),
        'tslib/modules': require.resolve('./shim-tslib.js'),
        'tslib/modules/index.js': require.resolve('./shim-tslib.js'),
        // Force @supabase/node-fetch to use its browser build to avoid Node stdlib (stream) on RN
        '@supabase/node-fetch': require.resolve('@supabase/node-fetch/browser.js'),
        // Force CJS build of punycode so whatwg-url can access ucs2.decode on Hermes
        punycode: require.resolve('punycode/punycode.js'),
      },
    },
  };
})();

module.exports = config;

