# Native Module Templates

This directory contains templates for creating platform-specific native modules with web stubs.

## Files

- **`native-module-template.ios.ts`** - Template for iOS implementation with native module
- **`native-module-template.web.ts`** - Template for web stub with no-op implementations

## Usage

### 1. Copy Templates

```bash
# Create your module directory
mkdir lib/my-feature

# Copy templates and rename
cp lib/examples/native-module-template.ios.ts lib/my-feature/MyFeature.ios.ts
cp lib/examples/native-module-template.web.ts lib/my-feature/MyFeature.web.ts
```

### 2. Customize

Open both files and:
- Replace `MyModule` with your module name
- Update `MyModuleName` to match your native module name
- Modify types to match your data structures
- Implement iOS methods
- Keep web methods as stubs

### 3. Import and Use

```typescript
import { MyFeature } from '@/lib/my-feature/MyFeature';

// Metro will auto-resolve to .ios.ts or .web.ts
```

## Key Points

- **Keep types identical** between `.ios.ts` and `.web.ts`
- **Web stubs should return sensible defaults** (false, null, [], etc.)
- **Add `isAvailable()` method** to check platform support
- **Use `__DEV__`** to show warnings only in development
- **Don't import native modules** in `.web.ts` files

## Examples

See working examples in the codebase:
- `lib/arkit/ARKitBodyTracker.{ios,web}.ts` - ARKit body tracking
- `lib/platform-utils.ts` - Platform detection helpers

## Documentation

- **Quick Reference**: `docs/QUICK_REFERENCE_PLATFORM_STUBS.md`
- **Complete Guide**: `docs/PLATFORM_SPECIFIC_CODE_GUIDE.md`
- **Summary**: `PLATFORM_STUBS_SUMMARY.md`

## Template Contents

Both templates include:
- ✅ Type definitions
- ✅ Module class with common methods
- ✅ React hook for easy component integration
- ✅ Error handling patterns
- ✅ Status checking
- ✅ Async operations

## Best Practices

1. Always test both iOS and web builds
2. Use TypeScript for type safety
3. Add console warnings in dev mode
4. Document platform requirements
5. Hide UI on unsupported platforms
6. Return graceful fallbacks on web

---

**Need help?** Check the full documentation in `docs/PLATFORM_SPECIFIC_CODE_GUIDE.md`

