# Auth + Stability Quick Wins

## TL;DR

> **Quick Summary**: Ship a focused hardening pass that restores real password recovery, reduces runtime DB initialization failures, and hardens upload/env failure paths, with TDD and agent-run QA for every task.
>
> **Deliverables**:
> - Working password reset flow
> - DB initialization guard/recovery path
> - Safer video-service env validation + user-facing error mapping
> - CI/Jest reliability quick fixes for regression protection
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 -> Task 4

---

## Context

### Original Request
User asked what can be fixed in the repo, then selected **Auth + Stability** and **Quick wins**.

### Interview Summary
**Key discussions**:
- Prioritize high-impact low-risk changes, not broad refactors.
- Use **TDD** as execution style.
- Keep scope tightly bounded to auth recovery and runtime stability.

**Research findings**:
- `app/(auth)/forgot-password.tsx` contains TODO-only reset behavior.
- `lib/services/database/local-db.ts` has repeated throw-only DB-not-initialized checks.
- `lib/services/video-service.ts` needs stronger env and upload error handling.
- `.github/workflows/ci-cd.yml` and `etc/jest.config.js` have reliability/coverage guardrail gaps.

### Metis Review
**Identified gaps (addressed in this plan)**:
- Missing explicit out-of-scope boundaries -> added strict guardrails.
- Missing negative-path verification detail -> added failure QA scenarios per task.
- Risk of scope creep into unrelated product work -> constrained task references and commit boundaries.

---

## Work Objectives

### Core Objective
Improve account recovery and runtime reliability with minimal-change fixes that are easy to review, test, and ship.

### Concrete Deliverables
- `app/(auth)/forgot-password.tsx` reset flow implemented against real auth provider behavior.
- `lib/services/database/local-db.ts` DB readiness helper + graceful recovery path for initialization failures.
- `lib/services/video-service.ts` env validation and upload failure mapping hardened.
- `.github/workflows/ci-cd.yml` and `etc/jest.config.js` updated with anti-regression reliability guardrails.

### Definition of Done
- [ ] Password reset happy/failure paths are executable and tested.
- [ ] DB init failures no longer produce uncontrolled cascading throws in covered code paths.
- [ ] Video upload/env failures return actionable user-safe errors.
- [ ] CI fails when tests are missing/failing and coverage guardrails are active.

### Must Have
- TDD workflow for all implementation tasks.
- Agent-executed QA scenarios with evidence capture.
- Narrow additive diffs; no broad refactor or format churn.

### Must NOT Have (Guardrails)
- No unrelated UI redesigns or feature additions outside auth/stability.
- No global cleanup/refactor across unrelated modules.
- No dependency upgrades or patch removals in this pass.
- No acceptance criteria requiring manual human verification.

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> Every task must be verifiable by agent-executed commands/tools only.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD
- **Framework**: jest + react testing library + playwright (for flow-level validation where applicable)

### If TDD Enabled
Each task executes RED-GREEN-REFACTOR:
1. RED: add failing tests
2. GREEN: minimum code to pass
3. REFACTOR: cleanup while keeping tests green

### Agent-Executed QA Scenarios
Each task includes both happy-path and failure-path scenarios with evidence in `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Start Immediately):
- Task 1 (Password reset)
- Task 2 (DB initialization resilience)

Wave 2 (After Wave 1):
- Task 3 (Video service hardening)
- Task 4 (CI/Jest guardrails)

Critical Path: Task 1 -> Task 4

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|----------------------|
| 1 | None | 4 | 2 |
| 2 | None | 3 | 1 |
| 3 | 2 | None | 4 |
| 4 | 1 | None | 3 |

---

## TODOs

- [ ] 1. Implement real password reset flow

  **What to do**:
  - RED: add tests for request-reset success and known failure states.
  - GREEN: replace timeout mock with real reset call + success/error UI state.
  - REFACTOR: extract error mapping helper local to auth flow.

  **Must NOT do**:
  - Do not redesign auth screens.
  - Do not add new auth providers.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` (auth reliability + behavior correctness)
  - **Skills**: `code-reviewer`, `playwright`
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` (visual polish not in scope)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `app/(auth)/forgot-password.tsx` - target flow currently placeholder/TODO.
  - `tests/unit/contexts/auth-context.test.tsx` - existing auth test style and mocking conventions.
  - `tests/e2e/auth.flow.spec.ts` - existing auth-flow assertions to mirror naming and style.
  - `lib/services/ErrorHandler.ts` - structured user-safe error mapping pattern.
  - `https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail` - canonical reset API semantics.

  **Acceptance Criteria**:
  - [ ] RED: reset-flow test cases fail before implementation.
  - [ ] GREEN: reset-flow test cases pass after implementation.
  - [ ] REFACTOR: tests remain green after cleanup.

  **Agent-Executed QA Scenarios**:

  ```text
  Scenario: Password reset request succeeds
    Tool: Playwright
    Preconditions: App running; known account email exists
    Steps:
      1. Navigate to /forgot-password
      2. Fill input[name="email"] with "known-user@example.com"
      3. Click button[type="submit"]
      4. Wait for success state element .reset-success (timeout: 10s)
      5. Assert .reset-success text contains "check your email"
      6. Screenshot: .sisyphus/evidence/task-1-reset-success.png
    Expected Result: Success message shown and no crash
    Failure Indicators: Stuck loading state, generic uncaught error, no success banner
    Evidence: .sisyphus/evidence/task-1-reset-success.png

  Scenario: Password reset request fails for invalid email
    Tool: Playwright
    Preconditions: App running
    Steps:
      1. Navigate to /forgot-password
      2. Fill input[name="email"] with "bad-email"
      3. Click button[type="submit"]
      4. Wait for .error-message (timeout: 5s)
      5. Assert .error-message contains validation or request error text
      6. Screenshot: .sisyphus/evidence/task-1-reset-failure.png
    Expected Result: Error is surfaced safely; no navigation or crash
    Evidence: .sisyphus/evidence/task-1-reset-failure.png
  ```

  **Commit**: YES
  - Message: `fix(auth): implement real forgot-password reset flow`

- [ ] 2. Add DB initialization resilience helper

  **What to do**:
  - RED: add tests covering db-not-initialized call paths.
  - GREEN: centralize DB readiness check and graceful initialization/retry logic.
  - REFACTOR: replace duplicated throw-only guards in high-traffic methods first.

  **Must NOT do**:
  - Do not rewrite storage layer architecture.
  - Do not change persistence schema.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` (stateful failure-mode hardening)
  - **Skills**: `code-reviewer`
  - **Skills Evaluated but Omitted**: `playwright` (module-level reliability task)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  - `lib/services/database/local-db.ts` - duplicated init guards and target for consolidation.
  - `tests/setup.ts` - global test environment/mocks used by unit tests.
  - `scripts/ci_local.py` - local CI parity constraints for test execution.

  **Acceptance Criteria**:
  - [ ] RED: DB readiness tests fail pre-change.
  - [ ] GREEN: readiness/recovery tests pass.
  - [ ] REFACTOR: duplicate throw-only guard count reduced in targeted methods.

  **Agent-Executed QA Scenarios**:

  ```text
  Scenario: DB consumer recovers after delayed initialization
    Tool: Bash
    Preconditions: Unit test file for DB readiness exists
    Steps:
      1. Run test command for DB readiness suite
      2. Assert exit code is 0
      3. Assert output contains recovery-path test names passing
      4. Save output to .sisyphus/evidence/task-2-db-recovery.txt
    Expected Result: No uncaught "Database not initialized" in covered paths
    Evidence: .sisyphus/evidence/task-2-db-recovery.txt

  Scenario: Hard init failure surfaces stable typed error
    Tool: Bash
    Preconditions: Test simulates init failure
    Steps:
      1. Run failure-path unit test
      2. Assert expected typed/user-safe error is returned
      3. Save output to .sisyphus/evidence/task-2-db-failure.txt
    Expected Result: Controlled failure response, not cascading throws
    Evidence: .sisyphus/evidence/task-2-db-failure.txt
  ```

  **Commit**: YES
  - Message: `fix(db): centralize readiness checks and recovery path`

- [ ] 3. Harden video service env validation and upload error mapping

  **What to do**:
  - RED: add tests for missing env vars, oversize upload, and upstream upload errors.
  - GREEN: enforce explicit env preconditions and consistent user-facing error mapping.
  - REFACTOR: normalize error construction with shared ErrorHandler usage.

  **Must NOT do**:
  - Do not alter upload architecture/provider.
  - Do not add non-required media features.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `code-reviewer`
  - **Skills Evaluated but Omitted**: `frontend-ui-ux` (non-visual service hardening)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - `lib/services/video-service.ts` - primary target for env/upload handling.
  - `lib/services/ErrorHandler.ts` - preferred standard for consistent error output.
  - `etc/jest.config.js` - ensure new service tests are included in coverage paths.

  **Acceptance Criteria**:
  - [ ] RED: missing-env and upload-failure tests fail first.
  - [ ] GREEN: tests pass with explicit errors and messages.
  - [ ] REFACTOR: error mapping is consistent with ErrorHandler conventions.

  **Agent-Executed QA Scenarios**:

  ```text
  Scenario: Missing env vars fail fast with safe error
    Tool: Bash
    Preconditions: Test harness can unset service env vars
    Steps:
      1. Run unit test that executes upload call with missing env
      2. Assert failure is deterministic and message is actionable
      3. Save output to .sisyphus/evidence/task-3-env-failure.txt
    Expected Result: Controlled precondition error returned immediately
    Evidence: .sisyphus/evidence/task-3-env-failure.txt

  Scenario: Oversize upload returns mapped user-safe error
    Tool: Bash
    Preconditions: Test fixture exceeds size threshold
    Steps:
      1. Run oversize upload test case
      2. Assert mapped error code/message expected by UI layer
      3. Save output to .sisyphus/evidence/task-3-oversize.txt
    Expected Result: No raw stack traces or ambiguous error text
    Evidence: .sisyphus/evidence/task-3-oversize.txt
  ```

  **Commit**: YES
  - Message: `fix(video): validate env and normalize upload errors`

- [ ] 4. Add CI/Jest anti-regression guardrails for this fix track

  **What to do**:
  - RED: add checks that fail when target tests are missing or failing.
  - GREEN: remove permissive no-test behavior for guarded paths and add explicit coverage threshold defaults.
  - REFACTOR: keep workflow changes minimal and localized.

  **Must NOT do**:
  - Do not redesign entire CI pipeline.
  - Do not add long-running platform builds beyond existing workflow intent.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `sre-ci-rca`, `code-reviewer`
  - **Skills Evaluated but Omitted**: `playwright` (pipeline configuration task)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - `.github/workflows/ci-cd.yml` - location of permissive test behavior and CI checks.
  - `etc/jest.config.js` - location for threshold/coverage guardrails.
  - `.husky/pre-push` - local enforcement consistency check.

  **Acceptance Criteria**:
  - [ ] CI guard tests fail when suite is empty/failing for targeted scope.
  - [ ] Coverage threshold settings exist and are enforced in CI command path.
  - [ ] Workflow remains green when all tests pass.

  **Agent-Executed QA Scenarios**:

  ```text
  Scenario: CI rejects missing tests in guarded path
    Tool: Bash
    Preconditions: Local CI script runnable
    Steps:
      1. Execute CI validation command for test stage
      2. Assert command fails when simulated no-test condition is introduced
      3. Save logs to .sisyphus/evidence/task-4-ci-no-tests.txt
    Expected Result: No silent pass on absent tests
    Evidence: .sisyphus/evidence/task-4-ci-no-tests.txt

  Scenario: CI passes with valid tests and thresholds
    Tool: Bash
    Preconditions: Test suite and coverage config valid
    Steps:
      1. Execute CI validation command for test/coverage stage
      2. Assert exit code 0
      3. Save logs to .sisyphus/evidence/task-4-ci-pass.txt
    Expected Result: Stable green path with explicit quality guardrails
    Evidence: .sisyphus/evidence/task-4-ci-pass.txt
  ```

  **Commit**: YES
  - Message: `ci(test): enforce guarded test and coverage checks`

---

## Commit Strategy

| After Task | Message | Verification |
|-----------|---------|--------------|
| 1 | `fix(auth): implement real forgot-password reset flow` | targeted auth tests + flow QA |
| 2 | `fix(db): centralize readiness checks and recovery path` | db readiness tests |
| 3 | `fix(video): validate env and normalize upload errors` | service failure-path tests |
| 4 | `ci(test): enforce guarded test and coverage checks` | local CI parity command |

---

## Success Criteria

### Verification Commands
```bash
bun test tests/unit/contexts/auth-context.test.tsx
bun test tests/unit/hooks/use-speech-feedback.test.ts
bun test
```

### Final Checklist
- [ ] Password reset flow works for success and failure paths.
- [ ] DB init error behavior is resilient and deterministic.
- [ ] Video service failures are safe, explicit, and test-covered.
- [ ] CI/Jest no longer silently accept missing/weak test coverage in guarded path.
