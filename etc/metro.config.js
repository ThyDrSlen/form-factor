const { resolve } = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = (() => {
  const projectRoot = resolve(__dirname, '..');
  const cfg = getDefaultConfig(projectRoot);

  const { resolver } = cfg;

  cfg.resolver = {
    ...resolver,
    // Nested checkouts must not enter this app's file map.
    blockList: [
      ...(Array.isArray(resolver.blockList) ? resolver.blockList : [resolver.blockList]).filter(Boolean),
      /[\\/]\.worktrees(?:[\\/]|$)/,
    ],
    // A stalled Watchman daemon can leave bundle requests waiting indefinitely.
    // Use Metro's built-in watcher; opt in only with a healthy local daemon.
    useWatchman: process.env.METRO_USE_WATCHMAN === '1',
    sourceExts: [...resolver.sourceExts, 'mjs', 'cjs'],
    assetExts: [...resolver.assetExts, 'task'],
  };

  return cfg;
})();

module.exports = withNativeWind(config, { input: './app/global.css' });
