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
    // Stub out packages that ship Node.js-only code incompatible with Hermes.
    //
    // onnxruntime-web: @huggingface/transformers pulls this in as an ONNX backend.
    // Its pre-compiled .mjs bundles contain `import(/* webpackIgnore: true */'node:fs')`
    // which hermesc cannot compile (it doesn't support dynamic import() syntax).
    // Metro doesn't re-transform pre-compiled node_modules, so the raw import()
    // ends up in main.jsbundle and causes "Invalid expression encountered" at archive.
    // On React Native/iOS the app uses the native arkit-body-tracker module, not
    // onnxruntime-web, so stubbing it to {} is safe.
    //
    // node:* protocol: belt-and-suspenders stub for any other leaking Node built-ins.
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName.startsWith('node:') ||
        moduleName === 'onnxruntime-web' ||
        moduleName.startsWith('onnxruntime-web/') ||
        moduleName === 'onnxruntime-node' ||
        moduleName.startsWith('onnxruntime-node/')
      ) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return cfg;
})();

module.exports = withNativeWind(config, { input: './app/global.css' });
