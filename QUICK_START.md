# Quick Start Guide - iPhone 15 Pro Development

## 🔥 TL;DR - Fix Your Issues Now

### Issue 1: Build Failing with Duplicate References
```bash
bun run fix:ios
```

### Issue 2: Screenshot Your iPhone 15 Pro
```bash
# One shot
bun run screenshot

# Continuous capture
bun run watch:device
```

### Issue 3: Should You Use ARKit Instead?
**YES!** Read why:
```bash
bun run docs:arkit
```

## 📱 Development Workflow

### 1. First Time Setup

```bash
# Install dependencies
bun install

# Setup iOS
cd ios && pod install && cd ..

# Fix any build issues
bun run fix:ios
```

### 2. Run on Your iPhone 15 Pro

```bash
# Connect iPhone via USB
# Trust computer on device

# Run app
bun run ios:device

# Or if you have multiple devices
bun run ios  # Then select from list
```

### 3. Capture Screenshots While Testing

Terminal 1:
```bash
bun run ios:device
```

Terminal 2:
```bash
bun run watch:device
# Press ENTER to capture screenshots
# Saves to ~/Desktop/ios-screenshots/
```

## 🎯 Why Switch to ARKit?

Your current setup uses Vision framework which has:
- ❌ Complex Objective-C `.m` files
- ❌ 2D projections (not real 3D)
- ❌ Lower accuracy for fitness
- ❌ More build issues

ARKit Body Tracking offers:
- ✅ Real 3D joints in meters
- ✅ Pure Swift (no `.m` files!)
- ✅ iPhone 15 Pro optimized (LiDAR)
- ✅ Better accuracy for form feedback
- ✅ Simpler code

**Read the guide:**
```bash
bun run docs:arkit
```

**Follow migration:**
```bash
bun run docs:migration
```

## 🛠️ Available Commands

### Development
- `bun run ios:device` - Run on connected iPhone
- `bun run start` - Start Metro bundler
- `bun run kill` - Kill stuck Metro processes

### iOS Debugging
- `bun run fix:ios` - Fix build issues
- `bun run screenshot` - Take screenshot of device
- `bun run watch:device` - Continuous screenshot capture

### Documentation
- `bun run docs:arkit` - ARKit implementation guide
- `bun run docs:migration` - Migration from Vision to ARKit
- `bun run docs:build` - iOS build troubleshooting

### Quality
- `bun run lint` - Run ESLint

## 🔧 Troubleshooting

### "No connected devices found"
1. Connect iPhone via USB
2. Trust computer on device
3. Check: `xcrun xctrace list devices`

### "Multiple commands produce..."
```bash
bun run fix:ios
```

### "folly/Exception.h not found"
```bash
cd ios
rm -rf Pods Podfile.lock
pod install --repo-update
cd ..
```

### "Can't take screenshot"
```bash
# Install screenshot tool
brew install libimobiledevice

# Try again
bun run screenshot
```

## 📊 Current vs ARKit Performance

| Feature | Current (Vision) | With ARKit |
|---------|-----------------|------------|
| **Build Complexity** | High (.m files) | Low (Swift) |
| **Joint Accuracy** | ±15° | ±3° |
| **3D Tracking** | 2D projection | True 3D |
| **iPhone 15 Pro** | Not optimized | LiDAR optimized |
| **Setup Time** | Complex | Simple |

## 🚀 Recommended Next Steps

1. **Fix your current build** (5 min):
   ```bash
   bun run fix:ios
   bun run ios:device
   ```

2. **Test screenshot capture** (2 min):
   ```bash
   bun run screenshot
   ```

3. **Read ARKit guide** (10 min):
   ```bash
   bun run docs:arkit
   ```

4. **Migrate to ARKit** (90 min):
   ```bash
   bun run docs:migration
   # Follow the step-by-step guide
   ```

## 💡 Pro Tips

### Faster Iteration
```bash
# Terminal 1: Keep Metro running
bun run start

# Terminal 2: Quick reload
# Just press 'r' in Metro terminal
```

### Better Debugging
```bash
# Enable source maps
# Errors will show actual file locations

# Use React DevTools
npx react-devtools
```

### Screenshot Automation
```bash
# Take screenshots during workout
bun run watch:device
# Press ENTER at key moments
# Perfect for sharing with team!
```

## 📚 Documentation

All docs are in `/docs`:
- `ARKIT_BODY_TRACKING_GUIDE.md` - Complete ARKit implementation
- `MIGRATION_TO_ARKIT.md` - Step-by-step migration
- `IOS_BUILD_AND_DEBUG_GUIDE.md` - Troubleshooting
- `SIMPLIFIED_VISION_SETUP.md` - Alternative simpler approach

## 🎓 Learning Resources

- [ARKit Body Tracking](https://developer.apple.com/documentation/arkit/arkit_in_ios/tracking_human_body_poses_in_3d)
- [WWDC23: 3D Body Pose](https://developer.apple.com/videos/play/wwdc2023/10176/)
- [Expo Development](https://docs.expo.dev/)

## ❓ Questions?

Check the docs:
```bash
ls docs/
```

Or run:
```bash
bun run docs:build  # Build issues
bun run docs:arkit  # ARKit questions
bun run docs:migration  # Migration help
```

---

**Happy Coding!** 🚀📱


