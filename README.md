# Product Requirements Document

## Project Overview

PT Expo App is a cross-platform fitness social media application built with Expo (React Native) that enables users to:

- Track workouts and performance metrics
- Analyze exercise form in real time with on-device MediaPipe/OpenCV overlays
- Share posts, comments, and progress with a community
- Receive audio/visual feedback and personalized recommendations

The primary focus is on iOS (local device) for the MVP, with web as a display-based interface, and Android support planned subsequently. By leveraging Expo’s Managed Workflow, Supabase for backend services, and GitHub-based CI/CD, we ensure rapid iteration, team collaboration, and seamless deployment.

## MVP Features

User Authentication & Authorization

Description: Secure sign-up, login, and password recovery via Supabase Auth. Supabase handles JWT issuance, email templates, and password resets out of the box.

Tech: Expo, @supabase/supabase-js, Supabase Edge Functions (TypeScript), Supabase CLI for migrations

User Registration & Login Screens (iOS-focused)

Description: SwiftUI-inspired UI implemented in React Native (Expo) for registration, login, and forgot-password flows. Tested on local iOS Simulator and physical devices via Expo Go or EAS Dev Client.

Tech: React Navigation, React Native Paper/UI Kit, Expo DevTools, Expo Dev Client

Post Creation & Feed

Description: Users can create text/image/video posts; view a real-time feed filtered by friends/followers. Web interface provides read-only access to feeds for display purposes.

Tech: Expo Video/Asset, Supabase Realtime, FlatList, Expo for Web (ReactDOM)

Real-Time Form Feedback

Description: Capture camera frames on-device, run MediaPipe (WASM) or OpenCV.js for pose estimation directly in the Expo JS thread via react-native-vision-camera or Expo Media Library. Overlay skeleton and highlight joint angles (green for correct, red for correction) calibrated for various camera positions.

Tech: react-native-vision-camera, MediaPipe WASM, OpenCV.js modules, device orientation APIs

On-Screen Visual & Audio Cues

Description: Color-coded overlays indicate form status; audio prompts via Expo AV name joints or suggest adjustments. Supports custom calibration workflow at first launch to align camera perspective.

Tech: Expo AV, React Native Reanimated, Expo Sensors API

Workout History & Metrics

Description: Save rep counts, durations, form-score snapshots to Supabase DB with offline caching in Expo SQLite. Automatic sync when network resumes.

Tech: Supabase Database with Row-Level Security, Expo SQLite, Supabase Webhooks for sync acknowledgement

Community Engagement

Description: Like/comment on posts; follow/unfollow users; view activity feed. Push notifications via Supabase Edge Functions hooking into Firebase Cloud Messaging.

Tech: Supabase Realtime, FCM via Expo Notifications

## CI/CD & Developer Collaboration

### Automated Deployment Pipeline

This project uses a comprehensive CI/CD pipeline with GitHub Actions, EAS Build, and Supabase for seamless development and deployment workflows.

#### GitHub Actions Workflow (`.github/workflows/ci-cd.yml`)

**Triggers:**
- Pull Requests → Preview builds for testing
- Push to `develop` → Staging deployment 
- Push to `main` → Production deployment

**Pipeline Stages:**

1. **Test & Lint** (All branches)
   ```bash
   npm ci
   npx tsc --noEmit          # TypeScript check
   npx eslint . --ext .ts,.tsx  # Linting
   npm test                   # Unit tests
   ```

2. **Preview Builds** (Pull Requests)
   ```bash
   eas build --platform all --profile preview --non-interactive
   ```

3. **Staging Deployment** (`develop` branch)
   ```bash
   # Deploy database changes
   supabase db push --project-ref $SUPABASE_STAGING_PROJECT_REF
   
   # Build and submit to internal tracks
   eas build --platform all --profile staging --auto-submit --non-interactive
   
   # Deploy OTA updates
   eas update --branch staging --message "Staging deployment"
   ```

4. **Production Deployment** (`main` branch)
   ```bash
   # Deploy database changes
   supabase db push --project-ref $SUPABASE_PRODUCTION_PROJECT_REF
   
   # Build and submit to app stores
   eas build --platform all --profile production --auto-submit --non-interactive
   
   # Deploy OTA updates
   eas update --branch production --message "Production deployment"
   
   # Create GitHub release
   gh release create v${{ github.run_number }}
   ```

#### EAS Build Profiles (`eas.json`)

- **`development`**: Local development builds with development client
- **`preview`**: Internal testing builds (APK/IPA) 
- **`staging`**: Staging environment with staging Supabase config
- **`production`**: Production app store builds with production config

#### Environment Management

**Staging Environment:**
- Supabase staging project for safe testing
- Internal app distribution (TestFlight/Internal Track)
- Staging domain for web builds

**Production Environment:**
- Production Supabase project
- App Store/Play Store distribution
- Production domain with CDN

#### Required GitHub Secrets

Add these secrets to your GitHub repository settings:

```bash
# Expo Configuration
EXPO_TOKEN=your_expo_access_token

# Supabase Configuration  
SUPABASE_ACCESS_TOKEN=your_supabase_access_token
SUPABASE_STAGING_PROJECT_REF=your_staging_project_ref
SUPABASE_PRODUCTION_PROJECT_REF=your_production_project_ref
SUPABASE_STAGING_URL=https://your-staging-project.supabase.co
SUPABASE_STAGING_ANON_KEY=your_staging_anon_key
SUPABASE_PRODUCTION_URL=https://your-production-project.supabase.co
SUPABASE_PRODUCTION_ANON_KEY=your_production_anon_key

# App Store Configuration
APPLE_TEAM_ID=your_apple_team_id
```

#### Developer Workflow

1. **Feature Development:**
   ```bash
   git checkout -b feature/your-feature
   # Make changes
   git push origin feature/your-feature
   # Create PR → Triggers preview build
   ```

2. **Staging Release:**
   ```bash
   git checkout develop
   git merge feature/your-feature
   git push origin develop
   # → Triggers staging deployment
   ```

3. **Production Release:**
   ```bash
   git checkout main
   git merge develop
   git push origin main
   # → Triggers production deployment + app store submission
   ```

#### Local Development Commands

```bash
# Setup CI/CD (run once)
./scripts/setup-cicd.sh

# Local development
npm start                    # Start Expo dev server
npm run ios                  # Run on iOS simulator
npm run web                  # Run web version

# Manual builds
eas build --profile preview  # Create preview build
eas submit --profile production  # Submit to app stores
eas update --branch production   # Push OTA update

# Database operations
supabase start              # Start local Supabase
supabase db push            # Deploy migrations
supabase gen types typescript  # Generate TypeScript types
```

#### Monitoring & Quality

**Error Tracking:** Sentry integration for runtime error monitoring
**Performance:** Expo Performance APIs + New Relic for backend monitoring  
**Testing:** Jest for unit tests, Cypress for E2E web testing
**Code Quality:** ESLint + Prettier with pre-commit hooks

### Version Control & Branching

**GitFlow Strategy:**
- `main` → Production releases
- `develop` → Staging/integration branch
- `feature/*` → Feature development
- `hotfix/*` → Emergency production fixes

**Code Review Process:**
- All PRs require review approval
- Automated tests must pass
- Preview builds generated for testing
- Merge only after QA approval

## Architecture Overview

### Frontend (Expo React Native)

Managed Workflow: Single codebase for iOS & web; Android added after MVP.

Camera & ML: react-native-vision-camera + MediaPipe WASM or OpenCV.js on-device inference for low latency.

UI & Navigation: React Navigation (native-stack), shadcn/ui or React Native Paper for consistent styling.

Local Development: expo start --ios to run on local iOS Simulator or physical device; expo run:ios via EAS Dev Client for custom native modules.

Web: expo start --web renders read-only feeds and dashboards in browser.

### Backend (Supabase)

Auth & Database: Supabase Auth, PostgreSQL with Row-Level Security.

Edge Functions: Supabase Edge Functions (TypeScript) for API routes (posts, form data ingest), notifications, and data validation logic.

Realtime & Storage: Supabase Realtime for feed updates; Supabase Storage for media files.

Migrations & CLI: Use Supabase CLI to manage database schema, seeds, and migrations in CI pipelines.

### Analytics & ML Services (Stretch)

Data Sync to BigQuery: Edge Functions or Supabase Webhooks push to Google Pub/Sub → Dataflow → BigQuery.

Vertex AI Recommendations: Python FastAPI backend on GCP for training/inference; invoked via HTTP from app or Edge Functions.

### Infrastructure & Monitoring

Build Services: EAS Build for iOS binaries; expo build:web + Vercel for web.

Error Tracking: Sentry (Expo plugin) for runtime errors; LogRocket for session replay.

Performance Monitoring: Expo Performance APIs; New Relic on Edge Functions.

## Platform Focus & Roadmap

Phase 1 (MVP): iOS-first app, core features + community feed + basic calibration. Web: read-only dashboard and feed display.

Phase 2: Android support via Expo, advanced Supabase→BigQuery analytics, ML-based recommendations.

Phase 3: Body composition estimator, deeper integrations (HealthKit, Google Fit), localization, accessibility compliance.

By aligning on Expo’s Managed Workflow capabilities for iOS and web, leveraging Supabase’s complete backend suite, and establishing robust CI/CD and collaboration practices, this PRD reflects an up-to-date, scalable architecture ready for team-based development and rapid iteration.