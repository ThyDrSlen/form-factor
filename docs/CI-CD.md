# CI/CD Pipeline Documentation

This document describes the current GitHub Actions pipeline and its safety gates.

## Overview

The pipeline enforces workflow policy checks, least-privilege permissions, blocking security checks, and deploy preflight validation before staging or production deployment.

## Workflow Jobs (`.github/workflows/ci-cd.yml`)

1. `changes`
   - Detects changed paths.
   - Exposes `docs_only` output for conditional job execution.

2. `policy`
   - Runs `bun run ci:policy`.
   - Blocks the pipeline if policy violations are found (floating refs, top-level write permissions, deploy gate drift).

3. `quality`
   - Runs TypeScript, ESLint, unit tests, and depcheck.
   - Depends on `changes` and `policy`.

4. `e2e-tests`
   - Runs Playwright tests.
   - Skips on docs-only changes.
   - Uses Playwright browser cache.

5. `build-check`
   - Validates EAS configuration.
   - Skips on docs-only changes.

6. `security`
   - Runs `npm audit --audit-level=moderate` (blocking with retries).
   - Runs `audit-ci` (blocking).
   - Runs TruffleHog secret scan with a pinned action ref.

7. `deploy-staging`
   - Runs only on `develop`.
   - Depends on `quality`, `build-check`, and `security`.
   - Runs deploy preflight script before Supabase/EAS steps.
   - Uses environment-specific concurrency group `deploy-staging`.

8. `deploy-production`
   - Runs only on `main`.
   - Depends on `quality`, `build-check`, and `security`.
   - Runs deploy preflight script before Supabase/EAS steps.
   - Uses environment-specific concurrency group `deploy-production`.

## Policy Guardrails

Policy checks are implemented in `scripts/ci/policy_check.py`.

Guardrails enforced:
- no floating action refs such as `@main` / `@master`
- no `latest` tags for Expo/EAS/Supabase setup in critical paths
- no broad top-level write permissions
- `deploy-staging` and `deploy-production` must include `security` in `needs`

Run locally:

```bash
bun run ci:policy
```

Run against fixtures:

```bash
bun run ci:policy -- scripts/ci/fixtures/workflow-bad-floating-ref.yml
bun run ci:policy -- scripts/ci/fixtures/workflow-bad-main-ref.yml
bun run ci:policy -- scripts/ci/fixtures/workflow-bad-top-level-write.yml
```

## Deploy Preflight

Deploy preflight is implemented in `scripts/ci/deploy_preflight.py`.

Checks:
- required environment variables are present per target environment
- deploy branch/ref is allowed for the target environment

Run locally:

```bash
bun run ci:deploy-preflight -- --env staging --ref refs/heads/develop
bun run ci:deploy-preflight -- --env production --ref refs/heads/main
```

## Dependency Update Workflow

Workflow: `.github/workflows/dependency-updates.yml`

Hardening behavior:
- minimal top-level permissions with job-scoped PR write permissions
- validation runs (`lint`, `check:types`, workflow policy check) before PR creation
- unique update branch names (`dependency-updates-${{ github.run_id }}`) to avoid collisions
- consistent labels and assignee metadata

## Local CI Parity

Local mirror script: `scripts/ci_local.py`

`python3 scripts/ci_local.py --quick` now includes:
- merge conflict marker check
- workflow policy check
- quality checks (lint, typecheck, tests)
- build-check parity
- deploy preflight parity checks (pass + wrong-ref failure)
- security checks

## Required Secrets

Set the following repository secrets for deploy paths:
- `EXPO_TOKEN`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_STAGING_PROJECT_REF`
- `SUPABASE_PRODUCTION_PROJECT_REF`
- `ASC_API_KEY_P8_BASE64` (production)

## Verification Commands

```bash
bun run ci:policy
python3 scripts/ci_local.py --quick
bun run test -- --passWithNoTests
bun run test:e2e
```
