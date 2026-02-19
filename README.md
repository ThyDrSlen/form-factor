# Form Factor 💪



Form Factor is an iOS-first fitness and health app built with Expo and Supabase. It gives real-time form cues from the phone camera—counting reps, flagging issues (e.g., swing on pull-ups, squat depth), and auto-logging sets—to improve outcomes and reduce injury. It also delivers fast offline workout/food logging, HealthKit-powered trends, video and form capture, and an experimental ARKit body-tracking flow. Web is mostly display-first.

## What it does
- Tracking: Offline-first foods and workouts using SQLite with sync queue, realtime backfill, conflict handling, and soft delete to Supabase.
- Health: HealthKit permissions, summaries (steps, HR, weight), trend analysis, and historical bulk sync to Supabase; watch connectivity helpers included.
- Form & media: ARKit body-tracking tab (pull-up/push-up rep detection, speech cues, Vision Camera overlay), Fusion Engine (combines camera, watch, and audio data), video capture/upload to Supabase Storage, and a feed with signed URLs plus comments.
- Coach & notifications: AI coach backed by Supabase Edge Function `coach` (OpenAI), push token registration and preferences, and Edge Function `notify` for Expo push delivery.
- UI/Navigation: Expo Router tabs, React Native Paper components; web target is read-only with Playwright smoke coverage.

## Status and roadmap
- Implemented: offline foods/workouts, HealthKit summaries/trends, video upload + feed, AI coach, push notification plumbing, Playwright auth flow, Jest unit scaffolding, Fusion Engine (v1).
- In progress: ARKit body-tracking polish (see `docs/ARKIT_BODY_TRACKING_GUIDE.md`) and metrics upload, broader E2E coverage, telemetry/error-handling hardening.
- Planned: Richer social/feed interactions, ML recommendations, production push campaigns.

## Repository layout
- `app/`: Expo Router screens (`(auth)`, `(tabs)`, `(modals)`); ARKit scan and dashboard live here.
- `components/`, `contexts/`, `hooks/`, `lib/`: shared UI, data, services (offline sync, healthkit, notifications, coach/video services).
- `lib/fusion/`: **Fusion Engine** core logic (sensor fusion, degradation modes).
- `modules/arkit-body-tracker/`: custom native module for ARKit.
- `backstage/`: POC for a developer portal (see `backstage/README.md`).
- `supabase/`: migrations and Edge Functions (`coach`, `notify`), plus storage bucket policies.
- `scripts/`: env/setup helpers (e.g., `preinstall-clean.js`), native build utilities, and repair scripts (UUID fixes, `ci_local.py`).

## Quick Start

For a detailed setup guide, see [docs/DEVELOPER_ONBOARDING.md](docs/DEVELOPER_ONBOARDING.md).

1.  **Install**: `bun install`
2.  **Env**: `cp .env.example .env.local` (fill in Supabase/Expo keys)
3.  **Run**: `bun run ios` (Simulator) or `bun run ios:device` (Physical Device)

## EAS Build Policy
- `eas build` does **not** run for pull requests; paid builds happen on `main` after merge (and on `develop` if you keep staging deploys automatic).
- Deploy jobs are gated by workflow policy checks, blocking security checks, and deploy preflight validation.
- Husky `pre-push` always runs `python3 scripts/ci_local.py --quick`. Local iOS preview builds run by default on `main`/`develop`, and can be enabled on feature branches with `CI_LOCAL_RUN_EAS_PREVIEW_LOCAL=1`.
- You can run `bun run ci:push` anytime to reproduce the hook, or `bun run preview:local:submit` to build locally and upload/submit the same `.ipa`.

## Testing and QA
- Lint/types: `bun run lint`, `bun run check:types`, `bun run check:dead-code`.
- Unit: `bun run test` (Jest + Testing Library).
- E2E (web target): `bun run test:e2e` (Playwright + Bun).
- E2E in Docker: `bun run test:e2e:docker` (containerized testing).
- E2E with UI: `bun run test:e2e:ui` (interactive debugging).

See [TESTING.md](TESTING.md) for detailed testing documentation.

## Backend (Supabase)

### Edge Functions (request flow)

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as Expo App
  participant Coach as Edge Function: coach
  participant OpenAI as OpenAI API

  User->>App: Enter prompt
  App->>Coach: functions.invoke('coach')<br/>JWT + {messages, context}
  Coach->>OpenAI: Chat completion (OPENAI_API_KEY)
  OpenAI-->>Coach: Response text
  Coach-->>App: { message }
  App-->>User: Render response
```

```mermaid
sequenceDiagram
  autonumber
  participant Server as Cron/Webhook/Backend
  participant Notify as Edge Function: notify
  participant DB as Postgres (service role)
  participant Expo as Expo Push API
  participant Device as User Device

  Server->>Notify: POST + x-notify-secret (optional)<br/>{userIds or tokens, title, body, data}
  Notify->>DB: Lookup tokens (SUPABASE_SERVICE_ROLE_KEY)
  DB-->>Notify: Tokens
  Notify->>Expo: Send batch (<= 90 tokens/request)
  Expo-->>Notify: Receipts
  Notify->>DB: Prune invalid tokens
  Notify-->>Server: {delivered, invalidTokens, attempted}
  Expo-->>Device: Push notification
```

### Source-of-truth links
- Migrations / schema: `supabase/migrations/`
- Storage policies: `supabase/migrations/012_create_video_buckets.sql`
- Coach guide: `docs/COACH_FUNCTION.md`
- Edge function code: `supabase/functions/coach/index.ts`, `supabase/functions/notify/index.ts`

## Documentation
- **Start Here**: `docs/DEVELOPER_ONBOARDING.md`.
- Repo standards and commands: `docs/AGENTS.md`.
- ARKit: `docs/ARKIT_BODY_TRACKING_GUIDE.md`.
- HealthKit sync/trends: `docs/HEALTHKIT_SYNC_AND_TRENDS_GUIDE.md` and `docs/HEALTHKIT_SYNC_QUICK_START.md`.
- Platform-specific/native tips: `docs/PLATFORM_SPECIFIC_CODE_GUIDE.md`, `docs/WATCH_APP_GUIDE.md`.
- CI/CD and releases: `docs/CI-CD.md`, `docs/TESTFLIGHT_WORKFLOW.md`, `docs/TESTFLIGHT_RELEASE.md`.
