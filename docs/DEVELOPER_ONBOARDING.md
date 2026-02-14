# Developer Onboarding Guide 🚀

Welcome to the Form Factor engineering team! This guide will help you set up your development environment and understand the core workflows.

## 1. Prerequisites

Before you begin, ensure you have the following installed:

- **macOS**: Required for iOS development.
- **Xcode**: Install from the Mac App Store. Ensure you have the iOS SDKs installed.
- **Bun**: We use Bun as our package manager and runtime for scripts.
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **Node.js**: Version 20+ (managed via `nvm` or `fnm` recommended).
- **Supabase CLI**: For local backend development.
  ```bash
  brew install supabase/tap/supabase
  ```
- **CocoaPods**: For iOS dependencies.
  ```bash
  sudo gem install cocoapods
  ```

## 2. Initial Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-org/form-factor-eas.git
    cd form-factor-eas
    ```

2.  **Install dependencies**:
    ```bash
    bun install
    ```

3.  **Configure Environment Variables**:
    Copy the example environment file:
    ```bash
    cp .env.example .env.local
    ```
    Fill in the required values:
    - `EXPO_PUBLIC_SUPABASE_URL`: Your Supabase project URL.
    - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key.
    - `EXPO_PUBLIC_PUSH_PROJECT_ID`: Expo Push project ID (optional for local dev).
    - `EXPO_TOKEN`: Required for EAS builds (ask a lead for access).

4.  **Setup Supabase (Local)**:
    If you are working on backend features or need the local database:
    ```bash
    supabase start
    ```
    This will spin up a local Postgres instance and Edge Functions.

## 3. Running the App

### iOS Simulator
The standard way to develop features:
```bash
bun run ios
```
This runs `expo run:ios` which builds the native app and launches it in the simulator.

### Physical iOS Device
For testing ARKit (which requires a real camera) or Watch connectivity:
1.  Connect your iPhone via USB.
2.  Run:
    ```bash
    bun run ios:device
    ```
    *Note: You may need to select your development team in Xcode (`ios/formfactoreas.xcworkspace`) first.*

### Web
For UI work that doesn't require native modules:
```bash
bun run web
```

## 4. Project Architecture

- **`app/`**: Expo Router screens. This is the entry point for UI.
- **`lib/fusion/`**: **The Fusion Engine**. This is the core logic that combines camera data (ARKit), watch sensors, and other inputs to track form.
- **`lib/workouts/`**: Definitions for specific exercises (Pull-ups, Push-ups, etc.).
- **`supabase/`**: Backend logic, migrations, and Edge Functions (`coach`, `notify`).
- **`modules/`**: Custom native modules (e.g., `arkit-body-tracker`).

## 5. Common Workflows

### Creating a New Workout
1.  Add a new definition in `lib/workouts/`.
2.  Implement the `WorkoutDefinition` interface.
3.  Register it in `lib/workouts/index.ts`.

### Database Changes
1.  Create a migration:
    ```bash
    supabase migration new my_change
    ```
2.  Edit the SQL file in `supabase/migrations/`.
3.  Apply locally:
    ```bash
    supabase db reset
    ```

### Running Tests
- **Unit Tests**: `bun run test`
- **Linting**: `bun run lint`
- **Type Checking**: `bun run check:types`

## 6. Troubleshooting

- **Build fails with "pod install" error**:
  Run `cd ios && pod install && cd ..` manually.
- **ARKit not working in Simulator**:
  ARKit requires a physical device with a camera. The simulator will show a fallback or error.
- **"Missing UUID" errors**:
  Run `bun run fix-uuids` (if available) or check `scripts/fix-invalid-uuids.ts`.

## 7. Need Help?
- Check `docs/` for specific guides (ARKit, HealthKit, etc.).
- Reach out in the team Slack channel.
