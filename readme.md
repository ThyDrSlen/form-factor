# Form Factor

## Architecture Overview

### Supabase Auth
- All authentication (sign-up, login, session management) happens in Supabase.
- Tokens are issued by Supabase Auth.
- Supabase generates a JWT token after successful login.

### Supabase Edge Functions
- Implement all business logic (authentication validation, database interactions, ML models, etc.) in Python.
- The JWT token is used to validate requests.

  ### iOS App
  <!--
  Acts as a client that interacts with Edge Functions to fetch data or perform actions.
  Displays the UI using SwiftUI (or UIKit).
  -->

### iOS App
- Acts as a client that interacts with Edge Functions to fetch data or perform actions.
- Displays the UI using SwiftUI (or UIKit).

# Form Factor

A SwiftUI-based iOS proof-of-concept for a fitness platform with offline-first persistence and real-time sync.

## Architecture Overview

### iOS App (SwiftUI)
- **Onboarding**  
  - `OnboardingView.swift`: requests HealthKit permissions via `HealthKitManager`.
- **Workout Entry**  
  - `WorkoutEntryView.swift` & `WorkoutEntryViewModel.swift`: logs workouts and writes to SwiftData.
- **Dashboard**  
  - `DashboardView.swift` & `DashboardViewModel.swift`: displays recent workouts from SwiftData and latest heart rate from HealthKit; triggers sync and real-time updates via SupabaseManager subscriptions.

### SwiftData (Offline-First)
- **@Model Classes**  
  - Define your schema in plain Swift with `@Model` and property wrappers.
- **ModelContainer**  
  - Inject your models via `.modelContainer(for:)`—no `.xcdatamodeld` needed.
- **Query & Save**  
  - Use `@Query` for fetches, insert via `modelContext.insert(...)`, and commit with `modelContext.save()`.

### Sync Manager
- **SyncManager.swift**  
  - Monitors network (`NWPathMonitor`), pushes local changes flagged by `needsSync` to Supabase, and pulls remote updates.
- **Real-Time**  
  - Uses Supabase Realtime subscriptions, now centralized in `SupabaseManager.swift` via `subscribeWorkoutChanges` and `subscribeFoodEntryChanges` for streamlined live updates.
- **Conflict Policy**  
  - MVP: last-write-wins based on timestamps; can be enhanced later.

### Supabase (Remote)
- **SupabaseManager.swift**  
  - Swift SDK (`supabase-swift`) handles authentication (User Sign-In), CRUD on `workouts` & `food_entries` tables, and real-time subscriptions via `subscribeWorkoutChanges` & `subscribeFoodEntryChanges`.
- **Project Setup**  
  - Table schema matches `WorkoutEntity`.  
  - Row-level security (RLS) ensures each user reads/writes only their own data.
- **Authentication**  
  - Supabase Auth issues JWTs; the app stores sessions via `SupabaseManager`.

## Getting Started
1. Clone the repo and open `form-factor.xcodeproj` in Xcode 15+ targeting iOS 17 or later.  
2. Ensure your Apple ID is signed in under Xcode → Preferences → Accounts.  
3. Run on a simulator or device; grant HealthKit access when prompted.  
4. Log workouts, view your dashboard, and observe offline-first behavior.  
5. Add your Supabase URL and anon key to **Info.plist**:
   ```xml
   <key>SUPABASE_URL</key>
   <string>https://your-project-ref.supabase.co</string>
   <key>SUPABASE_ANON_KEY</key>
   <string>your-anon-key</string>
   ```
6. Build and run—the app will connect to Supabase for remote sync.
7. Configure your Supabase project and update `SupabaseManager.swift` with your URL and anon key for remote sync.

## Building & Running in Xcode
1. Open `form-factor.xcodeproj` in Xcode 15+ targeting iOS 17 or later.
2. In **Signing & Capabilities**, add the **HealthKit** capability.
3. Select an iOS 17+ simulator or device.
4. Press ⌘+B to build, then ⌘+R to run.
5. Grant HealthKit access when prompted.

## Future Enhancements
- Supabase Edge Functions for business logic.  
- Android (Kotlin Multiplatform) client.  
- iCloud or background fetch for advanced sync.  
- Enhanced conflict resolution or CRDT-based model.