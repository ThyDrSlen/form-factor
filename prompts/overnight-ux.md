# Mission: Make Form Factor's UX Amazing

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).
The app helps users track workouts, get real-time form correction via ARKit, log food,
and view HealthKit trends.

## Your Goal

Make the user experience feel polished, intuitive, and delightful. The end user is someone
who trains 4-5x/week and wants to:
1. Log workouts and food FAST (offline-first, minimal taps)
2. See their progress clearly (HealthKit trends, body comp)
3. Get real-time form cues during exercises (ARKit camera overlay)
4. Feel motivated by the app's design and flow

## Codebase Reference

### Key Directories
- `app/(tabs)/` — Main tab screens: `index.tsx` (home/dashboard), `workouts.tsx`, `food.tsx`, `scan-arkit.tsx`, `coach.tsx`, `profile.tsx`
- `app/(auth)/` — Auth screens: `sign-in.tsx`, `sign-up.tsx`, `forgot-password.tsx`, `callback.tsx`
- `app/(modals)/` — Modal screens: `add-workout.tsx`, `add-food.tsx`, `workout-session.tsx`, `workout-insights.tsx`, `template-builder.tsx`, `templates.tsx`, etc.
- `app/(onboarding)/` — Onboarding: `welcome.tsx`, `profile-setup.tsx`, `nutrition-goals.tsx`, `arkit-permissions.tsx`, `arkit-usage.tsx`
- `components/` — Shared components: `workout/` (ExerciseCard, SetRow, TimerPill, RestTimerSheet), `dashboard-health/` (DashboardHealth, HealthTrendsView), `activity-rings/`, `weight-dashboard/`
- `contexts/` — State: `AuthContext.tsx`, `WorkoutsContext.tsx`, `FoodContext.tsx`, `HealthKitContext.tsx`, `NetworkContext.tsx`, `ToastContext.tsx`, `UnitsContext.tsx`, `NutritionGoalsContext.tsx`, `SocialContext.tsx`
- `lib/stores/session-runner.ts` — Zustand store for active workout session
- `lib/services/` — Backend services: `database/local-db.ts` (SQLite), `database/sync-service.ts` (offline sync), `rest-timer.ts`, `rep-logger.ts`, `fqi-calculator.ts`

### Styling Stack
- **NativeWind** (Tailwind CSS for React Native) — use `className` prop
- **React Native Paper** — UI component library (theme, buttons, cards, etc.)
- **Moti** — animations (from `moti` package)
- **Fonts**: Lexend (400/500/700 weights)

## What To Work On (in priority order)

### P0: Core UX Polish
- Audit every screen in `app/(tabs)/` for UX issues — focus on `index.tsx` (dashboard), `workouts.tsx`, `food.tsx`
- Audit modals in `app/(modals)/` — especially `add-workout.tsx`, `workout-session.tsx`, `add-food.tsx`
- Fix any janky transitions, missing loading states, or error states
- Make sure the offline-first experience is seamless (no spinners when offline, graceful degradation, clear sync status indicators via `contexts/NetworkContext.tsx`)
- Ensure the workout logging flow is 3 taps or fewer from home tab to entering a set (through `workouts.tsx` -> `add-workout.tsx` -> `workout-session.tsx`)
- Check that `components/workout/SetRow.tsx` and `components/workout/ExerciseCard.tsx` have intuitive interactions

### P1: Visual Design Consistency
- Audit `components/` for visual consistency across `workout/`, `dashboard-health/`, `activity-rings/`, `weight-dashboard/`
- Ensure typography hierarchy is clear using the existing React Native Paper theme
- Add subtle micro-interactions where they add value (haptic feedback via `expo-haptics`, smooth list animations via Moti or Reanimated)
- Check dark mode support if it exists in the Paper theme
- Make sure all screens use consistent spacing, padding, and color patterns

### P2: Form Analysis UX (ARKit Tab)
- Review `app/(tabs)/scan-arkit.tsx` and the web fallback `scan-arkit.web.tsx`
- Review `modules/arkit-body-tracker/` for the native module interface
- Review `lib/fusion/` — the sensor fusion engine (calibration, phase FSM, cue engine)
- Review `lib/workouts/` — exercise-specific form models (pullup.ts, pushup.ts, squat.ts, deadlift.ts, benchpress.ts, etc.)
- Make the camera overlay intuitive: user should immediately understand what to do
- Add clear visual indicators for rep counting and form quality (FQI score from `lib/services/fqi-calculator.ts`)
- Make form correction cues non-intrusive but impossible to miss (speech feedback via `hooks/use-speech-feedback.ts`)

### P3: Health Dashboard
- Review `components/dashboard-health/DashboardHealth.tsx` and `HealthTrendsView.tsx`
- Review `components/activity-rings/` and `components/weight-dashboard/`
- Review `contexts/HealthKitContext.tsx` and `lib/services/healthkit/` (health-metrics.ts, weight-trends.ts, health-aggregation.ts)
- Make HealthKit data visualization clear and motivating
- Show progress toward goals prominently (nutrition goals from `contexts/NutritionGoalsContext.tsx`)
- Weekly/monthly comparison views should be scannable at a glance

## Constraints
- Package manager is `bun` (never npm/yarn/npx). Use `bunx` instead of `npx`.
- NativeWind (Tailwind) for styling — use `className` prop
- React Native Paper for UI components
- Run `bun run lint` and `bun run check:types` after changes to verify
- Commit after each logical unit of work with descriptive messages
- Do NOT modify `supabase/` migrations or edge functions
- Do NOT modify `ios/` or `android/` native code directly
- Do NOT add new dependencies without documenting why in the commit message
- Do NOT touch `.env` files
- Do NOT modify files in `modules/` (native modules)
- Path alias: `@/` maps to project root

## Commit Convention
Use conventional commits: `feat(component): description` or `fix(screen): description`
Examples:
- `feat(dashboard): add sync status indicator to home tab`
- `fix(workout-session): reduce taps to start logging a set`
- `style(food): improve visual consistency with Paper theme`

## How To Verify Your Work
After each significant change:
1. `bun run lint` must pass
2. `bun run check:types` must pass
3. `bun run test` should not regress (existing tests in `tests/unit/`, `tests/integration/`)

## Style
- Keep code clean and well-typed (TypeScript strict)
- Prefer small, focused components
- Comment non-obvious logic
- Use existing patterns from the codebase — read similar files before writing new ones
- Match existing import patterns (`@/` alias)
