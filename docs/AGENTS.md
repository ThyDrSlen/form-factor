# Repository Guidelines

## Project Structure & Module Organization
Expo Router organizes screens inside `app/` by segment. Shared UI primitives sit in `components/` and `design-system/`, while contexts, hooks, and utilities live in `contexts/`, `hooks/`, and `lib/`. Native work belongs in `ios/`, `android/`, `native/`, and the custom `modules/arkit-body-tracker`. Assets (fonts, icons, media) stay in `assets/`; scripts and automation live in `scripts/`; docs and runbooks live in `docs/`. Playwright suites live in `tests/e2e/`.

## Build, Test, and Development Commands
Install dependencies through `bun install`. Start the Expo dev server with `bun run start`, or `bun run start:devclient` when using the custom development client. `bun run ios`, `bun run android`, and `bun run web` trigger platform-specific builds, while `bun run lint` enforces Expo’s ESLint config and `bun run check:dead-code` invokes Knip. Use `bun run fix:ios` or `./scripts/build-local-android.sh apk|aab` when native artifacts drift. Run automated scenarios via `bunx playwright test`, which boots the Expo web target defined in `playwright.config.ts`.

## Coding Style & Naming Conventions
Code is TypeScript with `strict` compiler settings inherited from `expo/tsconfig.base`. Stick to 2-space indentation, trailing commas, and the Expo ESLint rules (`bun run lint`). Components and providers use PascalCase filenames, hooks stay camelCase, and Expo Router folders follow `(segment)` naming. Prefer the `@/` import alias over deep relative paths. Styling should default to NativeWind utility classes; promote repeated patterns into the `design-system` tokens or shared components.

## Testing Guidelines
Add e2e specs as `tests/e2e/<feature>.flow.spec.ts`, mirroring the user journey they cover. Scenarios must remain independent, avoid `test.only`, and exercise mock fixtures rather than production Supabase resources. Capture traces and screenshots (already configured) before filing bugs. On every PR run `bunx playwright test --headed` for affected flows plus `bun run lint`, so CI and local expectations stay aligned.

## Commit & Pull Request Guidelines
The git log follows conventional commits (`feat:`, `build:`, `docs:`); keep subjects scoped and mention impacted platforms when helpful. Summarize behavior changes in the PR description, link the relevant issue, and attach screenshots or recordings for UI work. List manual verification steps, call out migrations or config updates, and update the relevant doc in `docs/` whenever setup instructions shift.

## Security & Configuration Tips
Never commit `.env` files or Supabase keys—load them via Expo secrets or CI. `eas.json` defines `development`, `preview`, `staging`, and `production` profiles, so confirm the target before running `eas build`. Device overrides live in `app.config.ts`, and config-only tooling lives under `config/`.
