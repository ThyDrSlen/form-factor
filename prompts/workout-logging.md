# Mission: Zero-Friction Workout Logging

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).

## Your Goal

Redesign the workout logging flow so a user can start logging a set in under 3 taps from
the home tab. The user's most common action is: open app -> tap exercise -> enter weight+reps -> done.

## Current Flow (audit this first)

The current workout flow goes through these files:
1. `app/(tabs)/index.tsx` — Home/dashboard tab (entry point)
2. `app/(tabs)/workouts.tsx` — Workouts list tab
3. `app/(modals)/add-workout.tsx` — Modal to create a new workout
4. `app/(modals)/workout-session.tsx` — Active workout session screen
5. `app/(modals)/templates.tsx` — Workout templates list
6. `app/(modals)/template-builder.tsx` — Build custom templates
7. `app/(modals)/session-history.tsx` — Past sessions

### Key Components
- `components/workout/ExerciseCard.tsx` — Displays an exercise with its sets
- `components/workout/ExercisePicker.tsx` — Select an exercise to add
- `components/workout/SetRow.tsx` — Individual set entry (weight + reps)
- `components/workout/SetActionSheet.tsx` — Actions on a set (delete, edit)
- `components/workout/ExerciseActionSheet.tsx` — Actions on an exercise
- `components/workout/RestTimerSheet.tsx` — Rest timer between sets
- `components/workout/TimerPill.tsx` — Compact timer display
- `components/workout/SessionMetaCard.tsx` — Session metadata display
- `components/workout/SetNotesModal.tsx` — Notes for a set

### State Management
- `lib/stores/session-runner.ts` — Zustand store for the active session (`useSessionRunner()`)
- `contexts/WorkoutsContext.tsx` — Workout history and CRUD operations
- `lib/services/database/local-db.ts` — SQLite for offline storage
- `lib/services/database/sync-service.ts` — Offline-first sync to Supabase

## What To Do

### Step 1: Audit Current Flow
- Map every tap from opening the app to completing a set entry
- Identify every unnecessary screen transition, confirmation, or modal
- Count total taps required for the most common action
- Document findings as comments in your first commit

### Step 2: Reduce Friction
Focus areas:
- **Quick-start from home**: Add a "Start Workout" or "Quick Log" FAB/button on `app/(tabs)/index.tsx` that goes directly to a session
- **Smart exercise selection**: Recent/frequent exercises at the top of `ExercisePicker.tsx`
- **Auto-fill from history**: Pre-populate weight/reps from the user's last set for that exercise (data available in `WorkoutsContext`)
- **One-tap set completion**: Make `SetRow.tsx` completable with a single tap after entering numbers
- **Template quick-start**: One-tap to start a session from a favorite template
- **Keyboard optimization**: Auto-focus the weight input, use numeric keyboard, tab to reps, enter to save

### Step 3: Reduce Visual Noise
- Remove unnecessary headers/chrome in the workout session view
- Make the active set visually prominent, completed sets compact
- Keep rest timer accessible but not blocking (`TimerPill.tsx` + `RestTimerSheet.tsx`)

### Step 4: Haptic & Audio Feedback
- Use `expo-haptics` for set completion, timer end, and rep logging
- Consider subtle sound cues for key moments (use `expo-av` if needed, but check if it's already imported)

## Constraints
- Package manager is `bun` (never npm/yarn/npx)
- NativeWind (Tailwind) for styling
- React Native Paper for UI components
- Run `bun run lint` and `bun run check:types` after changes
- Commit after each logical change with `feat(workout): description` format
- Do NOT modify `supabase/` migrations or edge functions
- Do NOT modify `ios/` or `android/` native code
- Do NOT add new dependencies without documenting why
- Do NOT touch `.env` files
- Path alias: `@/` maps to project root

## How To Verify
1. `bun run lint` must pass
2. `bun run check:types` must pass
3. `bun run test` should not regress
4. Count taps in the final flow — must be <= 3 from home to entering a set

## Success Criteria
- A user opening the app can be entering weight+reps within 3 taps
- Previous workout data auto-fills intelligently
- The workout session screen feels fast and focused
- No unnecessary modals or confirmation dialogs in the happy path
