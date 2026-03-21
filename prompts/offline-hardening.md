# Mission: Offline Experience Hardening

You are working on the Form Factor iOS fitness app (Expo 54 + React Native 0.83 + React 19).
The app uses an offline-first architecture with SQLite + Supabase sync.

## Your Goal

Audit every screen for offline behavior. Every action should work instantly with no spinners
when offline. When the sync queue has pending items, show a subtle indicator. Find and fix
any code that calls Supabase directly without going through the offline-first layer.

## Offline Architecture (understand this first)

### Data Flow
1. All mutations write to local **SQLite** immediately (`lib/services/database/local-db.ts`)
2. Mutations queue in a `sync_queue` table
3. When online, queue syncs to **Supabase** (`lib/services/database/sync-service.ts`)
4. Realtime subscriptions pull remote changes
5. Web uses an in-memory fallback (`lib/services/database/local-db.web.ts`)

### Key Files
- `lib/services/database/local-db.ts` — SQLite wrapper (foods, workouts, health metrics, nutrition goals)
- `lib/services/database/local-db.web.ts` — Web in-memory fallback
- `lib/services/database/sync-service.ts` — Offline-first sync engine with Supabase
- `lib/services/database/generic-sync.ts` — Generic sync utilities
- `contexts/NetworkContext.tsx` — Network state provider (online/offline detection)
- `lib/network-utils.ts` — Network utility functions
- `lib/supabase.ts` — Supabase client initialization

### Context Providers (check each for offline handling)
- `contexts/AuthContext.tsx` — Auth state (should work with cached session)
- `contexts/WorkoutsContext.tsx` — Workout CRUD (should use local-db)
- `contexts/FoodContext.tsx` — Food logging (should use local-db)
- `contexts/HealthKitContext.tsx` — HealthKit data (local device data, always available)
- `contexts/SocialContext.tsx` — Social features (may need online, should degrade gracefully)
- `contexts/NutritionGoalsContext.tsx` — Goals (should persist locally)
- `contexts/UnitsContext.tsx` — User unit preferences (should persist locally)

### Services to Audit (check for direct Supabase calls)
- `lib/services/coach-service.ts` — AI coach (needs network, should show clear offline message)
- `lib/services/social-service.ts` — Follow/block/share (needs network for social graph)
- `lib/services/video-service.ts` — Video upload/streaming (needs network, should queue uploads)
- `lib/services/notifications.ts` — Push notifications (needs network for registration)
- `lib/services/healthkit/health-supabase.ts` — HealthKit sync to Supabase (should queue)
- `lib/services/SessionManager.ts` — Session management (should use cached auth)
- `lib/services/OAuthHandler.ts` — OAuth (needs network, should show clear message)
- `lib/services/consent-service.ts` — Consent tracking (should persist locally)

## What To Do

### Step 1: Audit Direct Supabase Calls
Search the entire codebase for direct `supabase.from(` or `supabase.rpc(` or `supabase.storage` calls
that bypass the offline-first layer (`local-db.ts` + `sync-service.ts`). List every instance.

Focus on:
- `app/` screens
- `contexts/` providers
- `hooks/` 
- `components/`

Exclude (these are expected to call Supabase directly):
- `lib/services/database/sync-service.ts` (it IS the sync layer)
- `lib/services/database/generic-sync.ts`
- `lib/supabase.ts` (client init)

### Step 2: Add Sync Status Indicator
- In `contexts/NetworkContext.tsx`, expose sync queue count/status
- Create a subtle, non-intrusive sync indicator component that shows:
  - Online + synced: nothing visible (clean state)
  - Online + syncing: subtle animated indicator (e.g., small spinning icon)
  - Offline + pending items: "Offline - X changes pending" pill
  - Offline + no pending: "Offline" pill (minimal)
- Add this indicator to the relevant layout (`app/_layout.tsx` or tab layout `app/(tabs)/_layout.tsx`)

### Step 3: Fix Offline Regressions
For each direct Supabase call found in Step 1:
- If data CAN be cached locally: route through local-db + sync-service
- If data REQUIRES network (coach, social, video): add clear offline state
  - Show a tasteful "Available when online" message
  - Disable the action but keep the UI visible
  - Use `NetworkContext` to check status

### Step 4: Test Offline Scenarios
Mentally walk through each screen as if the device has no network:
- Can the user log a workout? (must work fully offline)
- Can the user log food? (must work fully offline)
- Can the user view their history? (must work from local-db)
- Can the user see HealthKit data? (must work, it's local device data)
- What happens on the coach tab when offline? (should show clear message)
- What happens on the social/video features? (should degrade gracefully)

## Constraints
- Package manager is `bun` (never npm/yarn/npx)
- NativeWind (Tailwind) for styling
- React Native Paper for UI components
- Run `bun run lint` and `bun run check:types` after changes
- Commit after each logical change with `fix(offline): description` format
- Do NOT modify `supabase/` migrations or edge functions
- Do NOT modify `ios/` or `android/` native code
- Do NOT add new dependencies without documenting why
- Do NOT touch `.env` files
- Path alias: `@/` maps to project root

## How To Verify
1. `bun run lint` must pass
2. `bun run check:types` must pass
3. `bun run test` should not regress (check `tests/unit/services/sync-service.test.ts` especially)

## Success Criteria
- Zero spinners or loading states appear when the device is offline
- Every mutation (food, workout, goals) writes to SQLite immediately
- A clear but non-intrusive sync status is visible when offline or syncing
- Services that require network show helpful offline messages, not crashes
- No direct Supabase calls in screens/components (all go through the offline layer)
