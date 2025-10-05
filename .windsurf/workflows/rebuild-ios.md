---
description: Rebuild iOS native project and launch app
---

# Rebuild iOS Workflow

This workflow regenerates the iOS native project with all native modules and launches the app.

## Steps

1. **Kill any running Metro servers**
   ```bash
   bun run kill
   ```

2. **Clear Metro cache**
   ```bash
   rm -rf node_modules/.cache && rm -rf .expo
   ```

3. **Reinstall dependencies** (if module configuration changed)
   ```bash
   bun install
   ```

4. **Regenerate iOS project with Expo prebuild**
   ```bash
   npx expo prebuild --platform ios --clean
   ```
   This regenerates the `ios/` folder with all native modules properly linked via Expo autolinking.

5. **Build and launch on iOS device/simulator**
   ```bash
   bun run ios
   ```
   This builds the app and launches it on the default iOS simulator or connected device.

## When to Use

- After adding or modifying native modules
- When getting "Cannot find native module" errors
- After changing `expo-module.config.json` or module `package.json`
- When native code changes aren't being picked up

## Notes

- The `ios/` folder is gitignored and regenerated each prebuild
- Step 4 can take 2-3 minutes for a full clean rebuild
- Step 5 will also run prebuild automatically if needed, but explicit prebuild ensures a clean state
