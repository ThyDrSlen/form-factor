# Form Factor Developer Portal

Welcome to the Form Factor internal documentation.

## Quick Links

| Resource | Description |
|----------|-------------|
| [PRD](PRD.md) | Product Requirements Document |
| [CI/CD](CI-CD.md) | Pipeline documentation |
| [ARKit Guide](ARKIT_BODY_TRACKING_GUIDE.md) | Body tracking implementation |

## Getting Started

1. Clone the repo: `git clone git@github.com:ThyDrSlen/form-factor.git`
2. Install deps: `bun install`
3. Run iOS: `bun run ios`

## Architecture

Form Factor is an Expo/React Native app with:

- **Frontend**: Expo Router, NativeWind, React Native Paper
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Native Modules**: ARKit body tracker, HealthKit, Watch Connectivity
