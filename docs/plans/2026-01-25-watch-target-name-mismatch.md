1764354199639# Watch Target Name Mismatch Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the watch target name used by Expo config with the existing Xcode target name so EAS can assign provisioning profiles without failing.

**Architecture:** Add a focused Jest unit test that asserts the watch target config name, then update the watch target config to the spaced target name used in the pbxproj.

**Tech Stack:** Expo config (`targets/watch-app/expo-target.config.js`), Jest, TypeScript.

### Task 1: Add failing test for the watch target name

**Files:**
- Create: `tests/unit/targets/watch-target-config.test.ts`
- Test: `tests/unit/targets/watch-target-config.test.ts`

**Step 1: Write the failing test**

```ts
const config = require('../../../targets/watch-app/expo-target.config.js');

describe('watch target config', () => {
  it('uses the Xcode watch target name', () => {
    expect(config.name).toBe('Form Factor Watch Watch App');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/targets/watch-target-config.test.ts`

Expected: FAIL with `Expected: "Form Factor Watch Watch App"` and `Received: "FormFactorWatchApp"`.

### Task 2: Update the watch target name in config

**Files:**
- Modify: `targets/watch-app/expo-target.config.js`
- Test: `tests/unit/targets/watch-target-config.test.ts`

**Step 1: Write minimal implementation**

```js
name: 'Form Factor Watch Watch App',
```

**Step 2: Run test to verify it passes**

Run: `bun run test tests/unit/targets/watch-target-config.test.ts`

Expected: PASS.

**Step 3: Run diagnostics**

Run LSP diagnostics on:
- `targets/watch-app/expo-target.config.js`
- `tests/unit/targets/watch-target-config.test.ts`

Expected: No errors.

**Step 4: Commit**

```bash
git add tests/unit/targets/watch-target-config.test.ts targets/watch-app/expo-target.config.js
git commit -m "fix(watch-app): align watch target name with Xcode"
```

### Task 3: Patch apple-targets to use display name for EAS credentials

**Files:**
- Modify: `node_modules/@bacons/apple-targets/build/with-widget.js`
- Create: `patches/@bacons+apple-targets+3.0.7.patch`
- Create: `tests/unit/targets/apple-targets-eas-target-name.test.ts`

**Step 1: Write the failing test**

```ts
const fs = require('fs');
const path = require('path');

describe('apple-targets EAS target name', () => {
  it('uses the display name for targetName', () => {
    const filePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'node_modules',
      '@bacons',
      'apple-targets',
      'build',
      'with-widget.js',
    );

    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toContain('targetName: targetDisplayName');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/targets/apple-targets-eas-target-name.test.ts`

Expected: FAIL with `Expected substring: "targetName: targetDisplayName"`.

**Step 3: Patch the plugin**

```js
targetName: targetDisplayName,
```

**Step 4: Generate patch-package patch**

Create `patches/@bacons+apple-targets+3.0.7.patch` to capture the change.

**Step 5: Run test to verify it passes**

Run: `bun run test tests/unit/targets/apple-targets-eas-target-name.test.ts`

Expected: PASS.
