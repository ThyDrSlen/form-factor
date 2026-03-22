# Mission: ARKit Onboarding Flow

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).

## Your Goal

The scan tab (`app/(tabs)/scan-arkit.tsx`) is confusing for first-time users. Create an
onboarding overlay that shows the user how to position their phone, what exercises are
supported, and what the visual indicators mean. Make it skippable and remember if the
user has seen it.

## Existing ARKit Infrastructure

### Screens
- `app/(tabs)/scan-arkit.tsx` — Main ARKit camera tab (iOS)
- `app/(tabs)/scan-arkit.web.tsx` — Web fallback (no ARKit on web)
- `app/(onboarding)/arkit-permissions.tsx` — Camera permission request during onboarding
- `app/(onboarding)/arkit-usage.tsx` — Basic ARKit usage intro during onboarding

### Native Module
- `modules/arkit-body-tracker/` — Custom Expo native module for ARKit body tracking
  - Provides body joint positions from the camera feed
  - Emits pose data events to JavaScript

### Pose Processing Pipeline
- `lib/arkit/` — Platform-specific ARKit wrappers (`.ios.ts`, `.android.ts`, `.web.ts`)
- `lib/pose/` — Pose processing utilities
- `lib/fusion/` — Sensor fusion engine:
  - `engine.ts` — Core fusion logic combining camera + watch + audio
  - `calibration.ts` — User body calibration
  - `phase-fsm.ts` — Exercise phase state machine (up/down/transition)
  - `cue-engine.ts` — Real-time form correction cue generation
  - `movements.ts` — Movement definitions
  - `capabilities.ts` — Device capability detection
  - `contracts.ts` — Type contracts for fusion data

### Exercise Form Models
- `lib/workouts/pullup.ts` — Pull-up form model (phases, cues, thresholds)
- `lib/workouts/pushup.ts` — Push-up form model
- `lib/workouts/squat.ts` — Squat form model
- `lib/workouts/deadlift.ts` — Deadlift form model
- `lib/workouts/benchpress.ts` — Bench press form model
- `lib/workouts/dead-hang.ts` — Dead hang model
- `lib/workouts/farmers-walk.ts` — Farmer's walk model
- `lib/workouts/rdl.ts` — Romanian deadlift model
- `lib/workouts/index.ts` — Exercise registry and factory

### Tracking Quality
- `lib/tracking-quality/` — Rep detection filters, occlusion handling, confidence scoring

### Controller
- `hooks/use-workout-controller.ts` — Unified controller combining pose tracking, rep counting, FQI scoring
- `hooks/use-speech-feedback.ts` — Speech-based form cues

### Scoring
- `lib/services/fqi-calculator.ts` — Form Quality Index (0-100 score)
- `lib/services/rep-logger.ts` — Rep logging
- `lib/services/rest-timer.ts` — Rest timer between sets

## What To Do

### Step 1: Create ARKit Onboarding Overlay Component
Create a new component at `components/onboarding/ScanOnboarding.tsx` that:

1. **Welcome Step**: "Point your camera to track form"
   - Simple illustration/icon showing phone position
   - Brief explanation: "Form Factor uses your camera to count reps and check your form in real-time"

2. **Positioning Step**: "How to position your phone"
   - Show recommended angles: side view for squats/deadlifts, front view for pull-ups
   - Distance guidance: "Place your phone 6-8 feet away"
   - Tip: "Use a tripod or lean against something stable"

3. **Supported Exercises Step**: "What we can track"
   - List supported exercises from `lib/workouts/index.ts`:
     - Pull-ups, Push-ups, Squats, Deadlifts, Bench Press, Dead Hangs, Farmer's Walks, RDLs
   - Brief icon/emoji for each

4. **Visual Indicators Step**: "What you'll see"
   - Rep counter explanation
   - FQI score (form quality) explanation
   - Phase indicators (up/down/transition)
   - Form correction cues (speech + visual)

5. **Get Started**: "You're ready!" with a button to close

### Step 2: Persistence
- Use `@react-native-async-storage/async-storage` to store `arkit_onboarding_seen: true`
- Check this flag when `scan-arkit.tsx` mounts
- Show overlay only on first visit (or if user resets from settings)
- Add a "Show tutorial" option in `app/(tabs)/profile.tsx` to re-trigger

### Step 3: Integration
- Import and render the overlay in `app/(tabs)/scan-arkit.tsx`
- Overlay should appear on top of the camera view
- Should be dismissible at any step via "Skip" button
- Use Moti or Reanimated for smooth step transitions
- Use NativeWind for styling consistency

### Step 4: Web Fallback
- On web (`scan-arkit.web.tsx`), show a different message explaining ARKit is iOS-only
- Point users to download the iOS app

## Constraints
- Package manager is `bun` (never npm/yarn/npx)
- NativeWind (Tailwind) for styling
- React Native Paper for UI components
- Moti for animations
- Run `bun run lint` and `bun run check:types` after changes
- Commit after each logical change with `feat(arkit): description` format
- Do NOT modify `modules/arkit-body-tracker/` native code
- Do NOT modify `supabase/` migrations or edge functions
- Do NOT modify `ios/` or `android/` native code
- Do NOT add new dependencies without documenting why
- Do NOT touch `.env` files
- Path alias: `@/` maps to project root

## How To Verify
1. `bun run lint` must pass
2. `bun run check:types` must pass
3. `bun run test` should not regress

## Success Criteria
- First-time users understand what the scan tab does within 10 seconds
- The onboarding is beautiful, concise, and skippable
- Returning users never see it again (unless they choose to in settings)
- The overlay works smoothly on top of the camera view
- Web users get a clear "iOS-only" message
