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
    assetExts: [...resolver.assetExts, 'task'],
    // Stub out Node.js built-in `node:*` protocol imports that leak from
    // browser/universal packages (e.g. onnxruntime-web via @huggingface/transformers).
    // Those imports are always guarded by `process.versions?.node` checks, so they
    // are dead code on React Native, but hermesc rejects dynamic import() of them
    // during Hermes bytecode compilation. Returning { type: 'empty' } causes Metro
    // to replace them with an empty module and transforms import() to __r() calls
    // that hermesc can compile.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith('node:')) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return cfg;
})();

module.exports = withNativeWind(config, { input: './app/global.css' });
