---
description: Run lint and recursively fix all warnings until clean
---

# Lint and Fix Workflow

## Overview

Automatically run ESLint, identify issues, apply fixes, and repeat until the codebase is warning-free.

## Conceptual Checklist

- Run lint to identify all errors and warnings
- Categorize issues by type and file
- Apply automated fixes where safe
- Manually resolve complex issues
- Verify fixes don't break functionality
- Repeat until clean (0 errors, 0 warnings)
- Run type check to ensure changes are valid

## Steps

### 1. **Initial Lint Check**

// turbo

- Run `bun run lint` to get baseline state
- Capture output to identify total error/warning count
- Note the exit code (0 = clean, 1 = warnings, 2 = errors)

### 2. **Apply Automated Fixes**

// turbo

- Run `bun run lint --fix` to auto-fix simple issues
- This handles:
  - Import sorting
  - Trailing commas
  - Semicolons
  - Spacing issues
  - Simple formatting problems

### 3. **Re-run Lint and Categorize Remaining Issues**

// turbo

- Run `bun run lint` again to see what remains
- Group issues by type:
  - **Unused variables**: Remove or prefix with `_`
  - **Missing dependencies**: Add to dependency arrays or use eslint-disable
  - **Require imports**: Convert to ES imports or add eslint-disable
  - **React hooks violations**: Restructure hook calls
  - **Unescaped entities**: Replace with HTML entities
  - **Type issues**: Address TypeScript problems

### 4. **Fix Issues by Category**

#### 4a. **Unused Variables** (`@typescript-eslint/no-unused-vars`)

- Identify all unused variables in the lint output
- For each file:
  - Remove the variable if truly unused
  - Prefix with `_` if required by API but unused (e.g., `_error`)
  - Extract to separate module if reusable

#### 4b. **Missing Hook Dependencies** (`react-hooks/exhaustive-deps`)

- Review each hook with missing dependencies
- Determine if dependency should be added or excluded:
  - **Add**: If the value can change and should trigger re-run
  - **Exclude with comment**: If value is stable (e.g., `DEV`, stable functions)
  - **Refactor**: If dependency list is too complex, consider `useCallback`/`useMemo`
- Add `// eslint-disable-next-line react-hooks/exhaustive-deps` with justification

#### 4c. **Require Imports** (`@typescript-eslint/no-require-imports`)

- Check if `require()` is platform-specific (iOS/Android/Web)
- If platform-specific and cannot be converted:
  - Add `// eslint-disable-next-line @typescript-eslint/no-require-imports`
  - Add comment explaining why (e.g., "Platform-specific dynamic import")
- If not platform-specific, convert to ES6 `import`

#### 4d. **React Hooks Violations** (`react-hooks/rules-of-hooks`)

- Ensure all hooks are called unconditionally
- Move conditional `useMemo`/`useCallback` before any early returns
- Never call hooks inside conditions, loops, or nested functions

#### 4e. **Duplicate Imports** (`import/no-duplicates`)

- Find files with multiple imports from same module
- Merge into single import statement
- Example: `import { A, B, C } from 'module'`

#### 4f. **Unescaped Entities** (`react/no-unescaped-entities`)

- Replace special characters in JSX text:
  - `'` → `&#39;` or `&apos;`
  - `"` → `&quot;`
  - `<` → `&lt;`
  - `>` → `&gt;`
  - `&` → `&amp;`

### 5. **Verify After Each Fix Round**

// turbo

- Run `bun run lint` after fixing each category
- Track progress: note reduction in error/warning count
- If new issues appear, address them before proceeding

### 6. **Post-Fix Validation**

// turbo

- Run full CI check: `bun run ci:local`
- Ensure both pass:
  - `bun run lint` (0 errors, 0 warnings)
  - `bun run check:types` (TypeScript compilation)
- If type errors appear, fix them and re-run lint

### 7. **Manual Review of Changes**

- Review all changes made during fix process
- Check for:
  - Logic changes that might affect behavior
  - Removed code that was actually needed
  - Over-aggressive eslint-disable comments
- Test affected features if significant changes were made

### 8. **Iteration Check**

- If warnings remain after all fixes, repeat from Step 3
- Maximum 3 iterations recommended
- If stuck after 3 iterations:
  - Document remaining issues in a TODO file
  - Add eslint-disable for acceptable warnings with justification
  - Consider if lint rules need adjustment in `etc/eslint.config.js`

### 9. **Final Verification**

// turbo

- Run `bun run ci:local` one final time
- Confirm output shows: `✖ 0 problems (0 errors, 0 warnings)`
- Run `git status` to review all modified files
- Ensure no unintended side effects

## Best Practices

### When to Use `eslint-disable`

- **DEV constant**: Always safe to exclude from dependency arrays
- **Platform-specific requires**: Cannot be converted to imports
- **Stable function references**: Functions defined with `useCallback` in parent
- **External library issues**: When lint rule conflicts with library patterns

### When NOT to Use `eslint-disable`

- To silence legitimate bugs
- As a shortcut for proper refactoring
- Without understanding the underlying issue
- Without adding explanatory comment

### Safe vs. Unsafe Fixes

**Safe** (can be automated):

- Removing truly unused variables
- Merging duplicate imports
- Escaping entities in JSX text
- Adding semicolons/commas

**Unsafe** (require review):

- Removing variables that might be needed
- Adding hook dependencies that cause infinite loops
- Restructuring hook call order
- Converting require() to import (may break platform-specific code)

## Troubleshooting

### Infinite Loop in useEffect

**Symptom**: Adding dependency causes component to re-render infinitely

**Fix**:

- Wrap dependency in `useMemo` or `useCallback`
- Extract stable value outside component
- Use `useRef` for mutable values that don't need re-renders

### ESLint Config Not Loading

**Symptom**: Error about module type or config parsing

**Fix**:

- Ensure `eslint.config.js` uses ESM syntax
- Check `etc/eslint.config.js` imports expo config correctly
- Verify `eslint-config-expo/flat.js` path is correct

### Type Errors After Lint Fix

**Symptom**: `tsc --noEmit` fails after fixing lint warnings

**Fix**:

- Review removed variables - may need type guards
- Check hook return types after restructuring
- Ensure imports include type imports where needed

## Success Criteria

- [ ] `bun run lint` exits with code 0
- [ ] No errors or warnings in output
- [ ] `bun run check:types` passes
- [ ] All tests still pass (if applicable)
- [ ] No unintended behavior changes
- [ ] All eslint-disable comments have justification

## Related Commands

- `bun run lint` - Run ESLint
- `bun run lint --fix` - Auto-fix simple issues
- `bun run ci:local` - Run lint + type check
- `bun run check:types` - TypeScript type check only
