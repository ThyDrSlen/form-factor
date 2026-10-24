# Repository structure

The root package owns the Expo mobile app. `apps/web/` owns the Next.js app, `packages/shared/` contains shared workspace code, and `modules/` contains native packages. Mobile native dependencies remain declared in the root app package.

## Mobile feature ownership

Keep Expo Router screens and layouts in `app/`. Feature-owned components, hooks, providers, and styles live together under `features/<feature>/`:

| Feature | Responsibility |
|---------|----------------|
| `auth` | Authentication provider and sign-out dialog |
| `coach` | Coach UI and preferences, streaming hooks, and generated session guidance |
| `form-tracking` | Camera tracking UI, calibration, form home, insights, debrief, and tracking hooks |
| `health` | Health dashboard, HealthKit provider, weight trends, and activity rings |
| `nutrition` | Food and nutrition-goal providers, food icon, and food screen styles |
| `onboarding` | Onboarding progress UI |
| `profile` | Profile screen styles |
| `social` | Social provider and video-comment styles |
| `voice` | Voice provider, controls, speech, and audio hooks |
| `workouts` | Workout session UI, providers, watch-session bridge, and session styles |

Create `components/`, `hooks/`, `contexts/`, or `styles/` inside a feature only when needed. Form tracking groups its home, journey, insights, and debrief components in subdirectories. Workout UI uses one `features/workouts/components/` directory.

Import concrete modules, for example `@/features/auth/contexts/AuthContext` or `@/features/form-tracking/hooks/use-workout-controller`. Relative imports within a feature are also supported. Avoid feature-wide export barrels that load unrelated screens or services.

## Shared code

- `components/`: reusable UI primitives such as accessible pressables, delete actions, and the crash boundary.
- `contexts/`: app-wide network, toast, units, and haptic preferences.
- `hooks/`: generic navigation, relative-time, and device thermal/battery hooks.
- `styles/`: shared tab theme, colors, and card dimensions. Screen-specific styles belong to their feature.
- `lib/`: reusable engines, services, stores, platform adapters, and infrastructure. The fusion engine, exercise definitions, database sync, and service implementations retain their existing paths.

Feature code can use shared code and explicit cross-feature imports. Shared UI primitives should not re-export feature components. Put code used by both mobile and web in `packages/shared/` when it is suitable for both runtimes.

## Configuration and tests

Shared tooling configuration lives in `etc/`. Root entry files remain where Expo, Metro, Babel, Jest, and other tools expect to find them. Workspace-specific configuration stays inside its workspace.

Tests remain in `tests/unit/` and `tests/integration/`, with existing suites organized by component, hook, provider, or service. Update imports and `jest.mock` paths when moving production modules. Jest also discovers colocated `*.test.ts(x)` files in `features/` and `lib/`. Web end-to-end suites remain in `tests/e2e/` and `apps/web/tests/e2e/`.

When adding or moving a source directory, check lint targets, Jest discovery and coverage, Tailwind content globs, and CI changed-path filters. All include `features/`.
