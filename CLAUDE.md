# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Form Factor is an iOS-first fitness tracking app built with Expo 54 + React Native 0.83 + React 19. It features offline-first workout/food tracking, HealthKit integration, ARKit body-tracking for form analysis, an AI coach, and a social video feed. Targets iOS (primary), Android, and web.

## Commands

| Task | Command |
|------|---------|
| Start dev server | `bun run start` |
| Run iOS (debug) | `bun run ios` |
| Run web | `bun run web` |
| Lint | `bun run lint` |
| Type check | `bun run check:types` |
| Lint + types | `bun run ci:local` |
| Unit tests | `bun run test` |
| Single test file | `bun test tests/unit/path/to/file.test.ts` |
| Tests (watch) | `bun run test:watch` |
| Tests (coverage) | `bun run test:coverage` |
| E2E tests | `bun run test:e2e` |
| Dead code check | `bun run check:dead-code` |
| Pre-push CI check | `bun run ci:push` |
| Full CI pipeline | `bun run ci:full` |
| Local iOS build | `bun run build:local:ios` |

**Package manager is Bun** (v1.2.22). Always use `bun` instead of npm/yarn/npx. Use `bunx` instead of `npx`.

## Architecture

### Routing (Expo Router — file-based)
- `app/` — All screens. Grouped folders `(auth)`, `(tabs)`, `(modals)`, `(onboarding)` control navigation layout, not URL paths.
- `app/_layout.tsx` — Root layout that nests all providers and handles auth-based routing (redirect to sign-in, onboarding, or tabs).

### State Management
- **React Context** for domain state: `contexts/AuthContext.tsx`, `WorkoutsContext.tsx`, `HealthKitContext.tsx`, `FoodContext.tsx`, `SocialContext.tsx`, `NutritionGoalsContext.tsx`, `UnitsContext.tsx`, `NetworkContext.tsx`, `ToastContext.tsx`.
- **Zustand** for workout session state: `lib/stores/session-runner.ts` — manages active session, exercises, sets, rest timer via `useSessionRunner()`.

### Provider nesting order (app/_layout.tsx)
`GestureHandlerRootView → BottomSheetModalProvider → ToastProvider → AuthProvider → NetworkProvider → UnitsProvider → HealthKitProvider → WorkoutsProvider → NutritionGoalsProvider → SocialProvider → FoodProvider`

### Data Layer — Offline-First
1. All mutations write to local **SQLite** immediately (`lib/services/database/local-db.ts`)
2. Mutations queue in a `sync_queue` table
3. When online, queue syncs to **Supabase** (`lib/services/database/sync-service.ts`)
4. Realtime subscriptions pull remote changes
5. Web uses an in-memory fallback (`local-db.web.ts`)

### Services (`lib/services/`)
- `database/local-db.ts` — SQLite wrapper (foods, workouts, health metrics, nutrition goals)
- `database/sync-service.ts` — Offline-first sync engine with Supabase
- `SessionManager.ts` — Singleton for Supabase session lifecycle
- `OAuthHandler.ts` — Singleton for Google/Apple OAuth
- `ErrorHandler.ts` — Centralized error domain system with `withErrorHandling()` wrapper
- `social-service.ts` — Follow/block/share logic
- `video-service.ts` — Video upload/streaming
- `coach-service.ts` — AI coach (calls Supabase Edge Function)
- `healthkit/` — HealthKit readers, metrics, bulk sync, weight trends
- `rest-timer.ts`, `rep-logger.ts`, `fqi-calculator.ts` — Workout session services

### Pose / Form Tracking
- `lib/fusion/` — Sensor fusion engine, movement definitions, phase FSM, calibration, cue engine
- `lib/tracking-quality/` — Rep detection filters, occlusion handling, confidence scoring
- `lib/workouts/` — Per-exercise form models (pullup, pushup, squat, deadlift, benchpress, etc.)
- `lib/arkit/` — Platform-specific ARKit wrappers (`.ios.ts`, `.android.ts`, `.web.ts`)
- `hooks/use-workout-controller.ts` — Unified controller combining pose tracking, rep counting, FQI scoring

### Native Modules (workspace packages in `modules/`)
- `arkit-body-tracker` — Custom ARKit body tracking native module
- `ff-healthkit` — HealthKit wrapper
- `ff-watch-connectivity` — Apple Watch communication

### Backend
- **Supabase** — PostgreSQL, Auth, Storage, Realtime
- `supabase/migrations/` — Database migrations
- `supabase/functions/coach/` — AI coach Edge Function
- `supabase/functions/notify/` — Push notification Edge Function
- `lib/supabase.ts` — Client initialization (platform-aware storage, Base64 polyfills for Hermes)

## Key Conventions

- **Path alias**: `@/` maps to the project root (e.g., `import { supabase } from '@/lib/supabase'`)
- **Platform-specific files**: Use `.ios.ts`, `.android.ts`, `.web.ts` suffixes for platform variants
- **Config files live in `etc/`**: eslint, jest, playwright, babel, tsconfig base, app.config are all in `etc/` with thin re-export files at root
- **Singletons**: `SessionManager.getInstance()`, `OAuthHandler.getInstance()`
- **Error handling**: Use `createError(domain, code, message, opts)` + `logError()` from `lib/services/ErrorHandler.ts`; wrap async ops with `withErrorHandling()`
- **Fonts**: Lexend (400/500/700) loaded globally in `_layout.tsx`
- **Styling**: NativeWind (Tailwind) + React Native Paper + Moti for animations

## Testing

- **Unit/integration tests**: `tests/unit/`, `tests/integration/`, and co-located `lib/**/*.test.ts`
- **E2E tests**: `tests/e2e/*.spec.ts` (Playwright on Expo web)
- **Test setup**: `tests/setup.ts` — mocks for expo-constants, AsyncStorage, expo-sqlite, Supabase
- **Jest config**: `etc/jest.config.js` (preset: `jest-expo`)
- **Naming**: Unit/integration use `*.test.ts(x)`, E2E use `*.spec.ts`

## CI/CD

- **GitHub Actions** (`.github/workflows/ci-cd.yml`): lint → type check → unit tests → E2E → security audit → EAS build → deploy
- **EAS Build** (`eas.json`): profiles for `development`, `preview`, `staging`, `production`
- **Husky pre-commit**: merge conflict check + `bun run ci:local`
- **Husky pre-push**: policy + lint + type check (skip with `CI_LOCAL_SKIP=1`)
- **Local CI**: `python3 scripts/ci_local.py` mirrors the GitHub Actions pipeline locally

## Overnight / Headless Rules

When running via `claude -p` in headless mode (overnight scripts in `scripts/overnight-*.sh`):

- Always run `bun run lint` and `bun run check:types` before committing
- Commit after each logical change, not one giant commit
- Never modify `supabase/migrations/`, `ios/` native code, `android/` native code, or `.env` files
- Never add new dependencies without documenting why in the commit message
- Never delete or modify existing test files to make tests pass — fix the source code instead
- Write commit messages in format: `feat(component): description` or `fix(screen): description`
- If a change requires a new dependency, skip it and document in `docs/OVERNIGHT_CHANGELOG.md`
- Available prompts live in `prompts/` — each is tailored to a specific codebase area
- Logs go to `logs/overnight/` (gitignored)
- Overnight branches use the `claude/` prefix

### Available Overnight Scripts

| Script | Purpose |
|--------|---------|
| `scripts/overnight-claude.sh` | Single-session run with one prompt |
| `scripts/overnight-multi-session.sh` | Multi-pass: audit, fix, verify |
| `scripts/overnight-parallel.sh` | 3 parallel agents via git worktrees |
| `scripts/overnight-review.sh` | Morning review helper + PR creation |

### Available Prompts

| Prompt | Focus Area |
|--------|------------|
| `prompts/overnight-ux.md` | Full UX overhaul (P0-P3 priorities) |
| `prompts/workout-logging.md` | Zero-friction workout logging flow |
| `prompts/offline-hardening.md` | Offline experience audit and fixes |
| `prompts/arkit-onboarding.md` | ARKit scan tab onboarding overlay |
| `prompts/health-dashboard.md` | Motivating health dashboard redesign |
| `prompts/test-coverage.md` | Unit test coverage sprint |

## Environment

- `.env` with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_TOKEN`, etc. See `.env.example` for all vars.
- Expo public env vars must be prefixed with `EXPO_PUBLIC_`.
