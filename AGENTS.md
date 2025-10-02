# Repository Guidelines

## Project Structure & Module Organization
Source screens live in `app/` using Expo Router segments; shared UI is in `components/` and `design-system/`. Cross-cutting state providers sit under `contexts/`, while reusable logic hooks live in `hooks/`. Business logic, API helpers, and utilities are collected in `lib/`. Native modules, including custom ARKit pieces, are organized under `native/` with platform-specific code in `ios/` and `android/`. Assets such as fonts, icons, and media are stored in `assets/`. End-to-end tests reside in `tests/e2e/`, and automation utilities live in `scripts/`. Consult `docs/` for ARKit setup and build guidance before touching native code.

## Build, Test, and Development Commands
Install dependencies with `bun install`. Run the Expo dev server via `bun run start`; use `bun run start:devclient` when targeting the custom development client. Launch native builds with `bun run ios` or `bun run android`, and the web preview with `bun run web`. Execute linting checks through `bun run lint`. End-to-end tests run with `bunx playwright test`, which auto-spawns the Expo web server defined in `playwright.config.ts`.

## Coding Style & Naming Conventions
All code is TypeScript with `strict` settings and the Expo ESLint flat config. Prefer 2-space indentation and trailing commas (Prettier-compatible). Components and hooks use PascalCase files (`NutritionCard.tsx`) except for Expo route segments, which follow folder-based naming. Use the `@/` base alias for intra-project imports instead of relative paths. Styling leans on Tailwind via NativeWind; keep utility class strings short and extract shared styles into the design system when reused.

## Testing Guidelines
Playwright drives e2e coverage; add specs in `tests/e2e/*/*.spec.ts` and model names after the flow under test (e.g., `auth.flow.spec.ts`). Tests should be independent, avoid `test.only`, and rely on fixtures instead of seeding production services. Capture traces and screenshots on failure are already configured—collect artifacts before filing bugs. When adding new UI flows, pair them with smoke-level e2e coverage and document edge cases in `PROGRESS.md`.

## Commit & Pull Request Guidelines
Follow the conventional commit style already in history (`feat:`, `chore:`, `docs:`). Keep commits scoped and descriptive; include native platform or package names when relevant. Pull requests need a clear summary, linked issue or ticket, and screenshots or screen recordings for UI-facing changes. Call out migrations or manual setup steps in the PR body and update relevant docs (`POSE_DETECTION_SETUP.md`, `QUICK_START.md`) when instructions change.
