# Form Factor

Form Factor is an iOS-first fitness and health tracking app built with Expo and Supabase. It focuses on fast offline logging of workouts and foods, HealthKit integration, and an experimental ARKit body tracking module. Web is display-focused; Android is planned.

## Configuration Files

Tooling configurations such as Babel, Metro, Tailwind, ESLint, Playwright, and the custom `tslib` shim now live in `etc/` to keep the project root clean. The root-level stubs simply re-export the real configs, so existing scripts continue to work without changes.

## Project Overview

Form Factor helps you:

- Log workouts and foods quickly
- View health trends from Apple Health (HealthKit)
- Experiment with on-device form insights (Vision/ARKit)
- Work reliably offline with automatic Supabase sync

MVP focus: iOS. Web is display-only. Android planned for when they have paying users.

## Current Status

- Implemented
  - Auth: email/password via Supabase Auth.
  - Offline-first data: SQLite queue/sync for foods and workouts with network detection, retry, and soft-delete.
  - Health metrics: reads from Apple Health (HealthKit) with a trends dashboard.
  - Navigation/UI: Expo Router, NativeWind/Tailwind.
- In progress
  - ARKit body tracking module and on-device pose insights (Vision/ARKit), iOS only.
  - E2E testing via Playwright.
  - Error handling and telemetry polish.
- Planned
  - Android support.
  - Social/feed features and notifications.
  - Advanced analytics and ML recommendations.

## MVP Features

User Authentication & Authorization

Description: Secure sign-up, login, and password recovery via Supabase Auth. Supabase handles JWT issuance, email templates, and password resets out of the box.

Tech: Expo, @supabase/supabase-js, Supabase Edge Functions (TypeScript), Supabase CLI for migrations

User Registration & Login Screens (iOS-focused)

Description: SwiftUI-inspired UI implemented in React Native (Expo) for registration, login, and forgot-password flows. Tested on local iOS Simulator and physical devices via Expo Go.

Tech: React Navigation, React Native Paper/UI Kit, Expo DevTools

Real-Time Form Feedback

Description: Capture camera frames on-device, run MediaPipe (WASM) or OpenCV.js for pose estimation directly in the Expo JS thread via react-native-vision-camera or Expo Media Library. Overlay skeleton and highlight joint angles (green for correct, red for correction) calibrated for various camera positions.

Tech: react-native-vision-camera, MediaPipe WASM, OpenCV.js modules, device orientation APIs

Workout History & Metrics

Description: Save rep counts, durations, form-score snapshots to Supabase DB with offline caching in Expo SQLite. Automatic sync when network resumes.

Tech: Supabase Database with Row-Level Security, Expo SQLite, Supabase Webhooks for sync acknowledgement

### Offline-First Architecture

Description: Complete offline support with local SQLite database and automatic bidirectional sync with Supabase. Users can add/delete foods and workouts while offline, with changes automatically synced when network is available. Includes Supabase Realtime websockets for live updates across devices.

Features:

- Local SQLite database for instant data access
- Network detection and automatic sync triggers
- Supabase Realtime for live cross-device updates
- Conflict resolution with retry logic
- Soft-delete strategy for data integrity
- Sync queue for failed operations

Tech: `expo-sqlite`, `expo-network`, Supabase Realtime, PostgreSQL with RLS

## Architecture Overview

### Frontend (Expo React Native)

Managed Workflow: Single codebase for iOS & web; Android added after MVP.

Camera & ML: react-native-vision-camera + MediaPipe WASM or OpenCV.js on-device inference for low latency.

UI & Navigation: React Navigation (native-stack), React Native Paper for consistent styling.

Local Development: expo start --ios for Simulator; use Xcode workspace for device builds and native module development.

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

Error Tracking: Sentry (Expo plugin) for runtime errors; LogRocket for session replay.

Performance Monitoring: Expo Performance APIs; New Relic on Edge Functions.

## Platform Focus & Roadmap

Phase 1 (MVP): iOS-first app, offline food/workout logging, HealthKit trends, experimental ARKit body tracking. Web: read-only dashboard.

Phase 2: Android support, expanded analytics, and early social features.

Phase 3: Body composition estimator, deeper integrations (HealthKit, Google Fit), localization, accessibility.

By aligning on Expo’s Managed Workflow for iOS and web and leveraging Supabase’s backend, Form Factor provides a pragmatic foundation for iterative development.

## Contributor Guide

See [`docs/AGENTS.md`](docs/AGENTS.md) for repository guidelines covering project layout, commands, coding standards, and pull request expectations.