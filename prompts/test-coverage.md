# Mission: Test Coverage Sprint

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).

## Your Goal

Write unit tests for every file in `lib/` and `hooks/` that doesn't have test coverage.
Use Jest + Testing Library patterns matching existing tests. Target the most critical paths
first: offline sync, HealthKit data processing, workout state management.

## Test Infrastructure

### Setup
- **Jest config**: `etc/jest.config.js` (preset: `jest-expo`)
- **Root config**: `jest.config.js` (re-exports from `etc/`)
- **Test setup**: `tests/setup.ts` — mocks for expo-constants, AsyncStorage, expo-sqlite, Supabase
- **Naming convention**: `*.test.ts(x)` for unit/integration tests
- **Run**: `bun run test` (all tests), `bun test path/to/file.test.ts` (single file)

### Existing Test Files (DO NOT MODIFY — just follow their patterns)

#### Unit Tests (`tests/unit/`)
- `tests/unit/services/sync-service.test.ts` — Sync service tests (REFERENCE for service tests)
- `tests/unit/contexts/food-context.test.tsx` — Food context tests (REFERENCE for context tests)
- `tests/unit/contexts/network-context.test.tsx` — Network context tests
- `tests/unit/contexts/workouts-context.test.tsx` — Workouts context tests
- `tests/unit/fusion/` — Fusion engine tests
- `tests/unit/hooks/` — Hook tests
- `tests/unit/workouts-*.test.ts` — Workout form model tests
- `tests/unit/tracking-quality*.test.ts` — Tracking quality tests
- `tests/unit/fqi-calculator.test.ts` — FQI calculator tests

#### Integration Tests (`tests/integration/`)
- `tests/integration/form-tracking-simulation.test.ts`
- `tests/integration/fusion-degradation.integration.test.ts`
- `tests/integration/fusion-latency.integration.test.ts`

#### Co-located Tests
- `lib/services/video-metrics.test.ts` — Video metrics tests

### Mock Patterns (from `tests/setup.ts`)
The test setup already mocks:
- `expo-constants`
- `@react-native-async-storage/async-storage`
- `expo-sqlite`
- Supabase client

## Priority Order (test these first)

### P0: Critical Path — Offline Data Layer
These files handle user data and MUST be reliable:

1. **`lib/services/database/local-db.ts`** — SQLite wrapper
   - Test: CRUD operations for foods, workouts, health metrics, nutrition goals
   - Test: sync queue operations (enqueue, dequeue, count)
   - Test: error handling for corrupted data
   - Mock: expo-sqlite

2. **`lib/services/database/generic-sync.ts`** — Generic sync utilities
   - Test: conflict resolution logic
   - Test: batch sync operations
   - Test: retry behavior

3. **`lib/services/SessionManager.ts`** — Supabase session lifecycle
   - Test: session persistence, refresh, expiry
   - Test: offline session caching
   - Mock: Supabase auth

### P1: Core Business Logic

4. **`lib/services/rest-timer.ts`** — Rest timer service
   - Test: timer start/stop/pause/resume
   - Test: timer completion callbacks
   - Test: persistence across app backgrounding

5. **`lib/services/rep-logger.ts`** — Rep logging
   - Test: rep recording with metadata
   - Test: rep numbering continuity
   - Test: integration with FQI scoring

6. **`lib/services/workout-runtime.ts`** — Workout runtime
   - Test: session lifecycle (start, pause, resume, finish)
   - Test: exercise/set management
   - Test: time tracking

7. **`lib/services/workout-insights.ts`** — Workout insights
   - Test: volume calculations
   - Test: PR detection
   - Test: trend analysis

8. **`lib/services/workout-insights-helpers.ts`** — Helper functions
   - Test: each helper function with edge cases

9. **`lib/stores/session-runner.ts`** — Zustand store
   - Test: state transitions (idle -> active -> paused -> finished)
   - Test: exercise addition/removal
   - Test: set completion/undo
   - Reference: follow Zustand testing patterns

### P2: HealthKit Processing

10. **`lib/services/healthkit/health-metrics.ts`** — Health metric fetching
    - Test: data transformation from HealthKit format
    - Test: handling missing data gracefully
    - Mock: native HealthKit bridge

11. **`lib/services/healthkit/health-aggregation.ts`** — Data aggregation
    - Test: daily/weekly/monthly aggregation
    - Test: average calculations
    - Test: empty dataset handling

12. **`lib/services/healthkit/weight-trends.ts`** — Weight trends
    - Test: trend line calculation
    - Test: outlier detection
    - Test: smoothing algorithm

### P3: Hooks

13. **`hooks/use-workout-controller.ts`** — Workout controller hook
    - Test: pose tracking integration
    - Test: rep counting accuracy
    - Test: FQI scoring pipeline
    - Use `@testing-library/react-native` renderHook

14. **`hooks/use-speech-feedback.ts`** — Speech feedback hook
    - Test: cue triggering conditions
    - Test: debouncing/throttling
    - Mock: expo-speech

15. **`hooks/use-safe-back.ts`** — Safe back navigation hook
    - Test: navigation behavior

16. **`hooks/use-debug-info.ts`** — Debug info hook
    - Test: debug data collection

### P4: Services

17. **`lib/services/coach-service.ts`** — AI coach
    - Test: message formatting
    - Test: error handling for API failures
    - Test: context building
    - Mock: Supabase functions

18. **`lib/services/social-service.ts`** — Social features
    - Test: follow/unfollow logic
    - Test: block/unblock logic
    - Mock: Supabase

19. **`lib/services/video-service.ts`** — Video upload/streaming
    - Test: upload queue management
    - Test: URL signing
    - Mock: Supabase storage

20. **`lib/services/notifications.ts`** — Push notifications
    - Test: token registration
    - Test: preference management
    - Mock: expo-notifications

21. **`lib/services/ErrorHandler.ts`** — Error handling
    - Test: error creation by domain
    - Test: withErrorHandling wrapper
    - Test: error logging

22. **`lib/services/consent-service.ts`** — Consent tracking
    - Test: consent state management
    - Test: persistence

23. **`lib/services/tut-estimator.ts`** — Time Under Tension estimator
    - Test: TUT calculations for different rep speeds

24. **`lib/services/onboarding.ts`** — Onboarding service
    - Test: onboarding state management

### P5: Utility Modules

25. **`lib/auth-utils.ts`** — Auth utilities
26. **`lib/network-utils.ts`** — Network utilities
27. **`lib/platform-utils.ts`** — Platform detection
28. **`lib/logger.ts`** — Logging
29. **`lib/video-feed.ts`** — Video feed utilities
30. **`lib/video-comments-events.ts`** — Video comment events

## Test File Naming Convention
- Place tests in `tests/unit/` mirroring the source structure
- Example: `lib/services/rest-timer.ts` -> `tests/unit/services/rest-timer.test.ts`
- Example: `hooks/use-safe-back.ts` -> `tests/unit/hooks/use-safe-back.test.ts`
- Example: `lib/stores/session-runner.ts` -> `tests/unit/stores/session-runner.test.ts`

## Test Template
```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Import the module under test
import { functionUnderTest } from '@/lib/services/module-name';

// Mock dependencies
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    // ... add needed methods
  },
}));

describe('ModuleName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('functionUnderTest', () => {
    it('should handle the happy path', () => {
      // Arrange
      // Act
      // Assert
    });

    it('should handle edge case', () => {
      // ...
    });

    it('should handle errors gracefully', () => {
      // ...
    });
  });
});
```

## Constraints
- Package manager is `bun` (never npm/yarn/npx)
- Run `bun run test` after writing each test file to verify it passes
- Commit after each test file with `test(module): add tests for module-name` format
- Do NOT modify source code to make tests pass — tests should match existing behavior
- Do NOT modify existing test files
- Do NOT modify `supabase/` or native code
- Do NOT touch `.env` files
- Path alias: `@/` maps to project root
- If a test requires a complex mock that doesn't exist in `tests/setup.ts`, create a focused mock in the test file

## How To Verify
1. `bun run test` — all tests pass (existing + new)
2. `bun run check:types` — no type errors in test files
3. Each test file tests at least 3 scenarios (happy path, edge case, error case)

## Success Criteria
- Every file in `lib/services/` has corresponding test coverage
- Every hook in `hooks/` has corresponding test coverage
- All tests pass reliably (no flaky tests)
- Tests follow existing patterns from `tests/unit/services/sync-service.test.ts`
- Test count increases by at least 50 new test cases
