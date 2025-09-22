# Design Document

## Overview

The Metro bundler error is caused by framer-motion's inability to access tslib's `__read` helper function. The current setup has overly complex tslib shimming that's interfering with proper module resolution. The solution involves simplifying the Metro configuration, ensuring proper tslib helper availability, and removing unnecessary shim files.

## Architecture

### Current Problem Analysis

1. **Complex Shim Setup**: Two different tslib shim files (`shim-tslib.js` and `tslib-proper-shim.js`) with overlapping functionality
2. **Over-aggressive Resolver**: Metro's custom resolver is intercepting all tslib imports, potentially causing conflicts
3. **Missing Helper Functions**: The `__read` helper function is not properly exposed or is being overridden
4. **Babel Transform Conflicts**: The babel runtime transform might be conflicting with the custom tslib resolution

### Solution Architecture

The fix will use a layered approach:

1. **Simplified Metro Configuration**: Remove complex custom resolver logic and use standard Metro resolver with targeted aliases
2. **Single Tslib Shim**: Consolidate to one comprehensive tslib shim that ensures all helpers are available
3. **Proper Helper Function Coverage**: Ensure all tslib helpers including `__read`, `__spread`, `__assign` are properly exported
4. **Babel Configuration Alignment**: Ensure babel transform settings don't conflict with tslib resolution

## Components and Interfaces

### Metro Configuration (`metro.config.js`)
- **Purpose**: Configure Metro bundler with minimal necessary overrides
- **Key Changes**:
  - Remove complex custom `resolveRequest` function
  - Use simple `alias` configuration for tslib
  - Maintain necessary Supabase and punycode overrides
  - Keep source extensions for `.mjs` and `.cjs` files

### Consolidated Tslib Shim
- **Purpose**: Provide a single, comprehensive tslib shim
- **Key Features**:
  - Import actual tslib package
  - Ensure all helper functions are available
  - Provide proper ESM/CJS interop
  - Include fallbacks for missing helpers
  - Specifically ensure `__read` function is available

### File Cleanup
- **Remove**: `shim-tslib.js` (redundant)
- **Keep**: `tslib-proper-shim.js` (enhanced version)
- **Verify**: No other files reference the removed shim

## Data Models

### Tslib Helper Functions Required
```typescript
interface TslibHelpers {
  __extends: Function;
  __assign: Function;
  __rest: Function;
  __decorate: Function;
  __param: Function;
  __metadata: Function;
  __awaiter: Function;
  __generator: Function;
  __read: Function;        // Critical for framer-motion
  __spread: Function;
  __spreadArrays: Function;
  __values: Function;
  __asyncValues: Function;
  __asyncGenerator: Function;
  __asyncDelegator: Function;
  __asyncIterator: Function;
  __makeTemplateObject: Function;
  __importStar: Function;
  __importDefault: Function;
  __classPrivateFieldGet: Function;
  __classPrivateFieldSet: Function;
}
```

## Error Handling

### Metro Resolution Errors
- **Strategy**: Use Metro's built-in error reporting
- **Fallback**: Provide clear error messages if tslib helpers are missing
- **Logging**: Enable Metro resolver logging during development

### Runtime Tslib Errors
- **Strategy**: Defensive programming in shim file
- **Fallback**: Provide polyfill implementations for missing helpers
- **Validation**: Check for helper function existence before export

### Build Process Errors
- **Strategy**: Validate configuration during Metro startup
- **Recovery**: Provide clear error messages with resolution steps
- **Testing**: Verify build process works with common dependency patterns

## Testing Strategy

### Unit Testing
- **Tslib Shim**: Test that all required helpers are available
- **Metro Config**: Verify resolver works with various import patterns
- **Helper Functions**: Test specific functions like `__read` work correctly

### Integration Testing
- **Framer Motion**: Verify framer-motion imports work without errors
- **Other Dependencies**: Test other packages that use tslib helpers
- **Build Process**: Ensure Metro bundling completes successfully

### Manual Testing
- **Development Server**: Start development server without errors
- **Hot Reload**: Verify hot reload works with tslib-dependent modules
- **Production Build**: Test production build process

## Implementation Approach

### Phase 1: Analyze Current State
1. Identify all tslib usage patterns in dependencies
2. Document current shim file functionality
3. Map Metro resolver behavior

### Phase 2: Create Enhanced Shim
1. Enhance `tslib-proper-shim.js` with all required helpers
2. Ensure `__read` function is properly implemented
3. Add comprehensive ESM/CJS interop

### Phase 3: Simplify Metro Config
1. Remove complex custom resolver
2. Use simple alias configuration
3. Maintain necessary overrides for Supabase/punycode

### Phase 4: Clean Up Files
1. Remove `shim-tslib.js`
2. Update any references to removed files
3. Verify no broken imports

### Phase 5: Test and Validate
1. Test Metro bundling process
2. Verify framer-motion works correctly
3. Test other tslib-dependent packages
4. Validate development and production builds