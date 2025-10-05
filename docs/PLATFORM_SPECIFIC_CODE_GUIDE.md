# Platform-Specific Code & Web Stubs Guide

This guide explains how to handle iOS-only functionality (ARKit, HealthKit, etc.) with proper web placeholders to ensure the app runs on all platforms.

## Strategy Overview

We use **three complementary approaches**:

1. **Platform-specific file extensions** - Metro auto-resolves `.web.ts`, `.ios.ts`, `.android.ts`
2. **Runtime platform checks** - `Platform.OS === 'web'` for conditional logic
3. **Safe module loading** - Try-catch patterns for native modules

---

## Approach 1: Platform-Specific Files (Recommended)

Metro automatically resolves platform-specific files based on extension priority:
- `module.ios.ts` → iOS
- `module.android.ts` → Android
- `module.web.ts` → Web
- `module.ts` → Fallback for all platforms

### Example: ARKit Body Tracker

#### iOS Implementation
**`lib/arkit/ARKitBodyTracker.ios.ts`**
```typescript
import { requireNativeModule } from 'expo-modules-core';

const ARKitBodyTracker = requireNativeModule('ARKitBodyTracker');

export interface Joint3D {
  name: string;
  x: number;
  y: number;
  z: number;
  isTracked: boolean;
}

export interface BodyPose {
  joints: Joint3D[];
  timestamp: number;
  isTracking: boolean;
  estimatedHeight?: number;
}

export class BodyTracker {
  static isSupported(): boolean {
    return ARKitBodyTracker.isSupported();
  }

  static async startTracking(): Promise<void> {
    await ARKitBodyTracker.startTracking();
  }

  static getCurrentPose(): BodyPose | null {
    return ARKitBodyTracker.getCurrentPose();
  }

  static stopTracking(): void {
    ARKitBodyTracker.stopTracking();
  }

  // ... other methods
}
```

#### Web Stub
**`lib/arkit/ARKitBodyTracker.web.ts`**
```typescript
// Web stub - provides type-compatible no-op implementations

export interface Joint3D {
  name: string;
  x: number;
  y: number;
  z: number;
  isTracked: boolean;
}

export interface BodyPose {
  joints: Joint3D[];
  timestamp: number;
  isTracking: boolean;
  estimatedHeight?: number;
}

export class BodyTracker {
  static isSupported(): boolean {
    console.warn('[BodyTracker] Not available on web');
    return false;
  }

  static async startTracking(): Promise<void> {
    throw new Error('ARKit body tracking is not available on web');
  }

  static getCurrentPose(): BodyPose | null {
    return null;
  }

  static stopTracking(): void {
    // No-op
  }

  // ... other methods as no-ops or throw errors
}
```

#### Usage (Same Code for All Platforms)
```typescript
import { BodyTracker } from '@/lib/arkit/ARKitBodyTracker';

// Works on all platforms - web returns false
if (BodyTracker.isSupported()) {
  await BodyTracker.startTracking();
}
```

---

## Approach 2: Runtime Platform Checks

Use `Platform.OS` for conditional rendering or logic within a single file.

### Example: HealthKit Dashboard Component

```typescript
import { Platform } from 'react-native';
import { useHealthKit } from '@/contexts/HealthKitContext';

export function DashboardHealth() {
  const { status, isLoading } = useHealthKit();

  // Hide completely on non-iOS platforms
  if (Platform.OS !== 'ios') {
    return null;
  }

  return (
    <View>
      <Text>Steps: {status?.stepsToday}</Text>
    </View>
  );
}
```

### Example: AsyncStorage vs Web Storage

```typescript
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getStoredSession(): Promise<Session | null> {
  // On web, use Supabase's built-in storage
  if (Platform.OS === 'web') {
    console.log('[SessionManager] Web - using Supabase storage');
    return null;
  }

  // On native, use AsyncStorage
  const storedData = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
  return storedData ? JSON.parse(storedData) : null;
}
```

---

## Approach 3: Safe Module Loading with Try-Catch

For modules that may not be available during development (before `npx expo prebuild`).

### Example: Lazy Loading Native Module

```typescript
// Lazy load to prevent crash before prebuild
let BodyTracker: any;

try {
  const module = require('@/lib/arkit/ARKitBodyTracker');
  BodyTracker = module.BodyTracker;
} catch (error) {
  console.log('ARKit module not available - run prebuild or on web');
}

export default function ScanScreen() {
  useEffect(() => {
    if (!BodyTracker) {
      Alert.alert(
        'Module Not Ready',
        'ARKit requires iOS. Please run: npx expo prebuild --platform ios --clean'
      );
      return;
    }

    const supported = BodyTracker.isSupported();
    if (!supported) {
      Alert.alert('Not Supported', 'ARKit requires iPhone XS or newer');
    }
  }, []);

  // ... rest of component
}
```

---

## Creating a New Platform-Specific Module

### Step 1: Create Platform-Specific Files

```bash
# iOS implementation
touch lib/my-native-feature/MyNativeModule.ios.ts

# Web stub
touch lib/my-native-feature/MyNativeModule.web.ts

# Shared types (optional)
touch lib/my-native-feature/types.ts
```

### Step 2: Define Shared Types

**`lib/my-native-feature/types.ts`**
```typescript
export interface MyNativeData {
  id: string;
  value: number;
  timestamp: number;
}

export interface MyNativeOptions {
  interval?: number;
  enabled?: boolean;
}
```

### Step 3: Implement iOS Version

**`lib/my-native-feature/MyNativeModule.ios.ts`**
```typescript
import { requireNativeModule } from 'expo-modules-core';
import type { MyNativeData, MyNativeOptions } from './types';

const NativeModule = requireNativeModule('MyNativeModule');

export class MyNativeModule {
  static async getData(options?: MyNativeOptions): Promise<MyNativeData[]> {
    return await NativeModule.getData(options);
  }

  static isAvailable(): boolean {
    return true;
  }
}

export * from './types';
```

### Step 4: Create Web Stub

**`lib/my-native-feature/MyNativeModule.web.ts`**
```typescript
import type { MyNativeData, MyNativeOptions } from './types';

export class MyNativeModule {
  static async getData(options?: MyNativeOptions): Promise<MyNativeData[]> {
    console.warn('[MyNativeModule] Not available on web');
    return [];
  }

  static isAvailable(): boolean {
    return false;
  }
}

export * from './types';
```

### Step 5: Create Context (Optional but Recommended)

**`contexts/MyNativeContext.tsx`**
```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { MyNativeModule } from '@/lib/my-native-feature/MyNativeModule';
import type { MyNativeData } from '@/lib/my-native-feature/types';

interface MyNativeContextValue {
  data: MyNativeData[];
  isAvailable: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const MyNativeContext = createContext<MyNativeContextValue | undefined>(undefined);

export function MyNativeProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<MyNativeData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const isAvailable = Platform.OS === 'ios' && MyNativeModule.isAvailable();

  const refresh = async () => {
    if (!isAvailable) return;

    setIsLoading(true);
    try {
      const result = await MyNativeModule.getData();
      setData(result);
    } catch (error) {
      console.error('[MyNativeContext] Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAvailable) {
      refresh();
    }
  }, [isAvailable]);

  return (
    <MyNativeContext.Provider value={{ data, isAvailable, isLoading, refresh }}>
      {children}
    </MyNativeContext.Provider>
  );
}

export function useMyNative() {
  const context = useContext(MyNativeContext);
  if (!context) {
    throw new Error('useMyNative must be used within MyNativeProvider');
  }
  return context;
}
```

### Step 6: Use in Components

```typescript
import { useMyNative } from '@/contexts/MyNativeContext';
import { Platform } from 'react-native';

export function MyComponent() {
  const { data, isAvailable, isLoading } = useMyNative();

  // Hide on web
  if (Platform.OS !== 'ios') {
    return <Text>This feature requires iOS</Text>;
  }

  if (!isAvailable) {
    return <Text>Feature not available</Text>;
  }

  if (isLoading) {
    return <Text>Loading...</Text>;
  }

  return (
    <View>
      {data.map(item => (
        <Text key={item.id}>{item.value}</Text>
      ))}
    </View>
  );
}
```

---

## Best Practices

### ✅ DO

1. **Use platform-specific files** for clean separation
2. **Export the same interface** from both `.ios.ts` and `.web.ts`
3. **Return sensible defaults** from web stubs (`false`, `null`, `[]`)
4. **Add console.warn()** in web stubs to help debugging
5. **Check `isAvailable()` or `isSupported()`** before using features
6. **Use contexts** to centralize native module usage
7. **Hide UI completely** on unsupported platforms using `Platform.OS`
8. **Document platform requirements** in comments

### ❌ DON'T

1. **Don't throw errors** in web stubs for read-only methods (use `null`/`false`)
2. **Don't import native modules** at the top level of `.web.ts` files
3. **Don't use platform checks** inside platform-specific files
4. **Don't forget types** - both files should have matching signatures
5. **Don't show broken UI** on web - hide or show alternative
6. **Don't hardcode platforms** - use `Platform.OS` checks
7. **Don't assume native availability** - always check support first

---

## Existing Patterns in the Codebase

### ARKit Body Tracking
- **Files**: `lib/arkit/ARKitBodyTracker.ts`
- **Pattern**: Try-catch lazy loading
- **Usage**: `app/(tabs)/scan-arkit.tsx`
- **Need**: Should be refactored to `.ios.ts` + `.web.ts`

### HealthKit
- **Files**: `lib/services/healthkit/*.ts`
- **Pattern**: Runtime checks + context
- **Usage**: `contexts/HealthKitContext.tsx`, `components/dashboard-health/`
- **Status**: ✅ Already handles web properly

### AsyncStorage
- **Files**: `lib/services/SessionManager.ts`
- **Pattern**: Runtime `Platform.OS === 'web'` checks
- **Status**: ✅ Working correctly

---

## Testing Web Stubs

### Run Web Build
```bash
bun run web
```

### Verify Stubs
1. Open web app in browser
2. Check console for warning messages
3. Verify no crashes when accessing native features
4. Confirm alternative UI or hidden sections work

### Expected Behavior
- ✅ No module import errors
- ✅ Feature detection returns `false`
- ✅ UI gracefully hides or shows alternatives
- ✅ Console shows helpful warnings (not errors)

---

## Migration Checklist

For each native module in the project:

- [ ] Identify all native module imports
- [ ] Extract shared types to `types.ts`
- [ ] Create `.ios.ts` with native implementation
- [ ] Create `.web.ts` with stub implementation
- [ ] Update imports to use base path (no extension)
- [ ] Add `isAvailable()` or `isSupported()` method
- [ ] Wrap in context if used by multiple components
- [ ] Add `Platform.OS` checks in UI components
- [ ] Test on web (should show alternatives)
- [ ] Test on iOS (should work normally)
- [ ] Update documentation

---

## Quick Reference

| Use Case | Approach | Example |
|----------|----------|---------|
| Native module that doesn't exist on web | Platform-specific files | `ARKitBodyTracker.ios.ts` + `.web.ts` |
| Component that only works on iOS | Runtime check + early return | `if (Platform.OS !== 'ios') return null` |
| Different storage mechanisms | Runtime check in method | `if (Platform.OS === 'web') { /* web code */ }` |
| Module not built yet (dev) | Try-catch lazy load | `try { require() } catch { }` |
| Centralized native access | Context provider | `HealthKitContext.tsx` |

---

## Additional Resources

- [Metro Platform-Specific Extensions](https://facebook.github.io/metro/docs/configuration/#platformspecific-extensions)
- [React Native Platform Module](https://reactnative.dev/docs/platform-specific-code)
- [Expo Module API](https://docs.expo.dev/modules/module-api/)
- Project docs: `ARKIT_BODY_TRACKING_GUIDE.md`, `SIMPLIFIED_VISION_SETUP.md`

