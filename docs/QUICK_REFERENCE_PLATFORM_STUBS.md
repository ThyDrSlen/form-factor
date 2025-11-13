# Quick Reference: Platform Stubs for Native Modules

## Quick Start

### Create a new native module with web stub:

```bash
# 1. Create the files
touch lib/my-module/MyModule.ios.ts
touch lib/my-module/MyModule.web.ts

# 2. Copy templates
cp lib/examples/native-module-template.ios.ts lib/my-module/MyModule.ios.ts
cp lib/examples/native-module-template.web.ts lib/my-module/MyModule.web.ts

# 3. Edit both files, replace "MyModule" with your module name
# 4. Implement iOS version, keep web version as stubs
```

## File Naming Pattern

```
lib/
  my-feature/
    MyFeature.ios.ts      ← iOS implementation (native)
    MyFeature.web.ts      ← Web stub (no-op)
    MyFeature.android.ts  ← Android (optional)
    types.ts              ← Shared types (optional)
```

## Import Pattern

**Always import without extension:**
```typescript
// Correct - Metro auto-resolves
import { MyModule } from '@/lib/my-feature/MyModule';

// Wrong - Don't specify extension
import { MyModule } from '@/lib/my-feature/MyModule.ios';
```

## Resolution Order

Metro resolves files in this order:
1. `.ios.ts` → iOS
2. `.android.ts` → Android
3. `.native.ts` → Both iOS & Android
4. `.web.ts` → Web
5. `.ts` → All platforms (fallback)

## Usage in Components

### Pattern 1: Hide on Web
```typescript
import { Platform } from 'react-native';
import { MyModule } from '@/lib/my-module/MyModule';

export function MyComponent() {
  // Hide completely on non-iOS platforms
  if (Platform.OS !== 'ios') {
    return null;
  }

  return <MyFeature />;
}
```

### Pattern 2: Check Availability
```typescript
import { MyModule } from '@/lib/my-module/MyModule';

export function MyComponent() {
  if (!MyModule.isAvailable()) {
    return <Text>Feature not available on this platform</Text>;
  }

  return <MyFeature />;
}
```

### Pattern 3: Use Platform Utils
```typescript
import { isIOS, isFeatureAvailable } from '@/lib/platform-utils';

export function MyComponent() {
  if (!isIOS()) {
    return <WebAlternative />;
  }

  return <NativeFeature />;
}
```

## iOS Implementation Template

```typescript
// MyModule.ios.ts
import { requireNativeModule } from 'expo-modules-core';

const NativeModule = requireNativeModule('MyModuleName');

export interface MyData {
  // Your types
}

export class MyModule {
  static isAvailable(): boolean {
    return NativeModule.isAvailable();
  }

  static async getData(): Promise<MyData[]> {
    return await NativeModule.getData();
  }
}
```

## Web Stub Template

```typescript
// MyModule.web.ts
export interface MyData {
  // Same types as iOS
}

export class MyModule {
  static isAvailable(): boolean {
    if (__DEV__) {
      console.warn('[MyModule.web] Not available on web');
    }
    return false;
  }

  static async getData(): Promise<MyData[]> {
    return [];
  }
}
```

## Helper Utilities

```typescript
import { 
  isIOS,
  isWeb,
  isNative,
  getPlatformValue,
  isFeatureAvailable,
  runOnPlatform 
} from '@/lib/platform-utils';

// Check platform
if (isIOS()) { /* iOS code */ }
if (isWeb()) { /* Web code */ }

// Get platform-specific value
const timeout = getPlatformValue({
  ios: 30,
  web: 60,
  default: 45
});

// Check feature availability
const hasARKit = isFeatureAvailable('ios', BodyTracker.isSupported());

// Run on specific platform
runOnPlatform('ios', () => {
  MyModule.start();
});
```

## Checklist for New Modules

- [ ] Create `.ios.ts` with native implementation
- [ ] Create `.web.ts` with type-compatible stubs
- [ ] Types match exactly between both files
- [ ] Include `isAvailable()` or `isSupported()` method
- [ ] Web stubs return sensible defaults (false, null, [])
- [ ] Add console.warn() in web stubs (dev mode only)
- [ ] Test web build (no crashes)
- [ ] Test iOS build (works normally)
- [ ] Add platform checks in UI components
- [ ] Update documentation

## Examples in Codebase

### ARKit Body Tracking
- **iOS**: `lib/arkit/ARKitBodyTracker.ios.ts`
- **Web**: `lib/arkit/ARKitBodyTracker.web.ts`
- **Usage**: `app/(tabs)/scan-arkit.tsx`

### HealthKit
- **Pattern**: Runtime checks with `Platform.OS`
- **Files**: `lib/services/healthkit/*.ts`
- **Context**: `contexts/HealthKitContext.tsx`

### Session Manager
- **Pattern**: Runtime checks for web vs native storage
- **File**: `lib/services/SessionManager.ts`

## Testing

### Test Web Build
```bash
bun run web
```

**Expected**: No crashes, features gracefully disabled

### Test iOS Build
```bash
bun run ios
```

**Expected**: Native features work normally

## Common Mistakes

### Don't: Import with extension
```typescript
import { MyModule } from '@/lib/my-module/MyModule.ios';
```

### Don't: Throw errors for getters in web stubs
```typescript
// Bad
static getData(): MyData[] {
  throw new Error('Not available');
}

// Good
static getData(): MyData[] {
  return [];
}
```

### Don't: Platform checks inside platform-specific files
```typescript
// MyModule.ios.ts
static isAvailable(): boolean {
  // Don't check Platform.OS here - file only runs on iOS
  if (Platform.OS === 'ios') { /* ... */ }
}
```

### Don't: Different types between iOS and web
```typescript
// MyModule.ios.ts
static getData(): Promise<MyData[]> { }

// MyModule.web.ts
static getData(): MyData[] { } // Missing Promise
```

## Full Documentation

- **Complete Guide**: `docs/PLATFORM_SPECIFIC_CODE_GUIDE.md`
- **Templates**: `lib/examples/native-module-template.{ios,web}.ts`

## Getting Help

1. Check existing patterns: ARKit, HealthKit
2. Read full guide: `docs/PLATFORM_SPECIFIC_CODE_GUIDE.md`
3. Use templates: `lib/examples/native-module-template.*`
4. Test on web first to catch issues early

---

**Remember**: The goal is to make iOS-only features work seamlessly while providing graceful fallbacks on web. Always test both platforms!

