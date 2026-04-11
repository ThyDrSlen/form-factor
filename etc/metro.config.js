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
    // @huggingface/transformers: on iOS Metro resolves this to
    // dist/transformers.web.js — a webpack pre-bundle that has onnxruntime-web
    // code INLINED.  That inlined code contains
    //   import(/* webpackIgnore: true */'node:fs')
    // which hermesc rejects ("Invalid expression encountered").
    // Stubbing onnxruntime-web alone is not enough because the import() call
    // lives inside transformers.web.js, never as a separate top-level require;
    // resolveRequest is never consulted for it.  Stubbing the parent package
    // prevents Metro from reading transformers.web.js altogether.
    //
    // onnxruntime-web / onnxruntime-node: belt-and-suspenders for any path that
    // bypasses the transformers pre-bundle and reaches these packages directly.
    //
    // ink / quickjs-wasi: terminal/WASM libs pulled in transitively by promptfoo
    // (a dev CLI tool); both contain literal import('node:fs') that hermesc rejects.
    //
    // node:* protocol: catch-all for any remaining Node built-in leakage.
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName.startsWith('node:') ||
        moduleName === '@huggingface/transformers' ||
        moduleName.startsWith('@huggingface/transformers/') ||
        moduleName === 'onnxruntime-web' ||
        moduleName.startsWith('onnxruntime-web/') ||
        moduleName === 'onnxruntime-node' ||
        moduleName.startsWith('onnxruntime-node/') ||
        moduleName === 'ink' ||
        moduleName.startsWith('ink/') ||
        moduleName === 'quickjs-wasi' ||
        moduleName.startsWith('quickjs-wasi/')
      ) {
        return { type: 'empty' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return cfg;
})();

module.exports = withNativeWind(config, { input: './app/global.css' });
