# Core Fusion Plan: Camera + Watch + AirPods (iOS)

## TL;DR

> **Quick Summary**: Build an iOS-first, real-time fusion core where camera pose is the coordinate anchor, watch and AirPods streams improve confidence/timing/continuity, and form cues are generated from a single compute-once feature pipeline.
>
> **Deliverables**:
> - Fusion core modules (ingestion, sync, calibration, fusion, phase, cues)
> - Movement profiles for squat, hinge, lunge, horizontal press, vertical press
> - TDD test suite + degradation matrix validation + runtime evidence capture
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8

---

## Context

### Original Request
Create a complete core fusion plan for real-time form tracking and cues using camera + watch + AirPods, with no duplicated math and practical real-time feedback.

### Interview Summary
**Key Discussions**:
- v1 platform is iOS only.
- User wants full movement launch scope (interpreted as 5 profiles in this plan).
- User wants explicit schema, thresholds, phase logic, and cue behavior.
- User explicitly flagged duplicate computation risk; pipeline must compute geometric features once and reuse them.

**Research Findings**:
- Existing runtime already has ARKit + pose smoothing + shadow provider logic in `app/(tabs)/scan-arkit.tsx`.
- Existing watch bridge and watch payload transport exist (`lib/watch-connectivity.ios.ts`, `lib/watch-connectivity/tracking-payload.ts`, `modules/ff-watch-connectivity/ios/FFWatchConnectivityModule.swift`, `targets/watch-app/WatchSessionManager.swift`).
- Existing adaptive runtime and test pattern exist (`lib/services/workout-runtime.ts`, `tests/unit/workout-runtime.test.ts`).
- Test infrastructure is ready for TDD (Jest + Playwright + CI).

### Metis Review
**Identified Gaps (addressed in this plan)**:
- Missing explicit sensor degradation policy -> Added 7-state degradation matrix tasks and acceptance criteria.
- Missing latency budget and sync constraints -> Added hard numeric budgets and validation tasks.
- Missing API viability gate for AirPods motion -> Added early spike task as a hard gate.
- Scope creep risk (rep scoring, persistence, analytics) -> Added strict out-of-scope guardrails.

---

## Work Objectives

### Core Objective
Implement a production-ready fusion core that emits stable `BodyState` updates and actionable cues in real time, anchored to camera pose while augmenting quality and continuity with watch/AirPods signals.

### Concrete Deliverables
- `lib/fusion/` module set for stream ingestion, sync, calibration, confidence, and fusion output.
- `lib/fusion/movements/` profiles for squat, hinge, lunge, horizontal press, vertical press.
- `lib/fusion/cues/` cue arbitration with persistence and cooldown.
- Integration hook for `app/(tabs)/scan-arkit.tsx` and watch message payload extension.
- TDD suite covering math, sync, degradation, phase transitions, cue arbitration, and integration paths.

### Definition of Done
- [x] Fusion pipeline computes each geometric feature once and all downstream consumers reuse cached values.
- [x] p95 fusion loop latency <= 150ms under normal device load.
- [x] Sensor degradation matrix behavior verified for all non-empty sensor states.
- [x] All unit/integration tests and existing CI test commands pass.

### Must Have
- Camera as primary coordinate anchor.
- Timestamp-aligned stream fusion with bounded skew handling.
- TDD workflow across all core modules.
- Agent-executed QA scenarios for every task.

### Must NOT Have (Guardrails)
- No Android implementation in this plan.
- No persistence/analytics dashboard buildout in fusion core.
- No raw PPG waveform assumptions; only accessible derived HR/context signals.
- No duplicate geometry math across modules.
- No rep scoring/ranking system in core fusion v1.

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> All acceptance criteria are agent-executable only. No manual tester actions are allowed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD
- **Framework**: Jest (unit/integration), Playwright (where UI applies), existing CI commands

### TDD Workflow (All Tasks)
1. **RED**: Create failing test for task behavior.
2. **GREEN**: Implement minimal code to pass.
3. **REFACTOR**: Keep tests green while improving structure.

### Agent-Executed QA Scenarios (All Tasks)
- Use `Bash` for module and test command verification.
- Use `interactive_bash` for tmux-driven native/runtime command validation.
- Use Playwright only where browser UI paths are directly touched.
- Store evidence in `.sisyphus/evidence/` with `task-{N}-{scenario}.(txt|png|json)` naming.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Start Immediately)
- Task 0: AirPods/watch API viability gate
- Task 1: Fusion contracts and feature registry design

Wave 2 (After Wave 1)
- Task 2: Stream ingestion + timestamp sync + degradation matrix
- Task 3: Calibration pipeline

Wave 3 (After Wave 2)
- Task 4: Core fusion engine (compute-once)
- Task 5: Movement profiles + phase FSM

Wave 4 (After Wave 3)
- Task 6: Cue engine (persist/cooldown/priority)
- Task 7: Runtime integration + watch payload propagation

Wave 5 (After Wave 4)
- Task 8: End-to-end validation, performance checks, CI hardening

Critical Path: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 8

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|---|---|---|---|
| 0 | None | 2, 7 | 1 |
| 1 | None | 2, 4, 5, 6 | 0 |
| 2 | 0, 1 | 3, 4 | None |
| 3 | 2 | 4, 5 | None |
| 4 | 1, 2, 3 | 5, 6, 7 | None |
| 5 | 1, 3, 4 | 6, 7 | None |
| 6 | 4, 5 | 7, 8 | None |
| 7 | 0, 4, 5, 6 | 8 | None |
| 8 | 6, 7 | None | None |

---

## TODOs

- [x] 0. Validate device/API viability for AirPods motion + watch streaming (hard gate)

  **What to do**:
  - Add RED tests and runtime guards for unavailable native capabilities.
  - Verify CMHeadphoneMotionManager path viability and fallback semantics.
  - Verify watch reachability/state transitions from existing bridge and watch app payload path.

  **Must NOT do**:
  - Do not use private iOS APIs.
  - Do not block pipeline startup if AirPods data is unavailable.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: native bridge + runtime diagnostics + guardrail-heavy behavior.
  - **Skills**: `expo-run-ios-fc`, `code-reviewer`
    - `expo-run-ios-fc`: verify real-device native behavior quickly.
    - `code-reviewer`: validate fallback/guard logic quality.
  - **Skills Evaluated but Omitted**:
    - `playwright`: not primary for native-capability gating.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: 2, 7
  - **Blocked By**: None

  **References**:
  - `modules/ff-watch-connectivity/ios/FFWatchConnectivityModule.swift` - Existing watch bridge behavior and event surface.
  - `lib/watch-connectivity.ios.ts` - JS wrapper and payload sanitization path to preserve.
  - `targets/watch-app/WatchSessionManager.swift` - Current watch-side message handling shape.
  - `docs/WATCH_APP_GUIDE.md` - Existing simulator/device setup expectations.
  - `https://developer.apple.com/documentation/coremotion/cmheadphonemotionmanager` - Public API contract for headphone motion.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: capability-gating tests fail before implementation (`bun run test -- tests/unit/fusion/capabilities.test.ts`).
  - [x] GREEN: tests pass and return deterministic fallback states when APIs unavailable.
  - [x] REFACTOR: guards centralized in one module with no duplicated checks.
  - [x] Scenario: `Runtime capability unavailable fallback`
    - Tool: Bash
    - Preconditions: test environment with mocked missing native modules
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/capabilities.test.ts`
      2. Assert output contains `fallback_mode_enabled` and `pass`
      3. Save output to `.sisyphus/evidence/task-0-capability-fallback.txt`
    - Expected Result: fallback path verified without crash
    - Evidence: `.sisyphus/evidence/task-0-capability-fallback.txt`
  - [x] Scenario: `Watch reachability transitions`
    - Tool: Bash
    - Preconditions: watch event payload fixtures available
    - Steps:
      1. Run `bun run test -- tests/unit/watch/reachability-transitions.test.ts`
      2. Assert state sequence includes paired->installed->reachable transitions
    - Expected Result: transition handling is deterministic
    - Evidence: `.sisyphus/evidence/task-0-watch-reachability.txt`

  **Commit**: YES (groups with 1)

- [x] 1. Define fusion contracts and compute-once feature registry

  **What to do**:
  - Define `BodyState`, stream contracts, and canonical feature registry.
  - Enforce one-pass geometric feature computation contract.
  - Define confidence model interface consumed by phase/cue layers.

  **Must NOT do**:
  - No business scoring logic in contract layer.
  - No direct UI dependencies in core contract types.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: high-leverage architecture contract decisions.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: enforce long-term maintainability of type contracts.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not needed for contract architecture.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 0)
  - **Blocks**: 2, 4, 5, 6
  - **Blocked By**: None

  **References**:
  - `lib/services/workout-runtime.ts` - Existing adaptive runtime utility style to mirror.
  - `lib/pose/realtime-form-engine.ts` - Existing smoothing state shape and tracking quality derivation.
  - `lib/pose/types.ts` - Existing pose-related type organization conventions.
  - `tests/unit/workout-runtime.test.ts` - Compact unit test style and assertion pattern.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: schema tests fail before contract implementation (`bun run test -- tests/unit/fusion/contracts.test.ts`).
  - [x] GREEN: contracts compile and tests pass.
  - [x] REFACTOR: no duplicated type alias definitions across fusion modules.
  - [x] Scenario: `Compute-once contract invariants`
    - Tool: Bash
    - Preconditions: contract tests implemented
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/contracts.test.ts`
      2. Assert test named `reuses_cached_feature_values` passes
    - Expected Result: downstream modules consume cached features only
    - Evidence: `.sisyphus/evidence/task-1-contracts.txt`

  **Commit**: YES (groups with 0)

- [x] 2. Build stream ingestion, timestamp sync, and 7-state sensor degradation matrix

  **What to do**:
  - Implement ingestion buffers for camera/watch/AirPods with monotonic timestamps.
  - Build resampling/alignment to 30Hz fusion tick.
  - Implement explicit behavior matrix for all non-empty sensor combinations.

  **Must NOT do**:
  - No implicit fallback behavior hidden in UI code.
  - No unbounded buffer growth.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: stream alignment and failure-mode logic are correctness critical.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: ensure deterministic state transitions and bounded memory.
  - **Skills Evaluated but Omitted**:
    - `expo-run-ios-fc`: not necessary for initial stream logic tests.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 3, 4
  - **Blocked By**: 0, 1

  **References**:
  - `app/(tabs)/scan-arkit.tsx` - Existing polling intervals and runtime update cadence.
  - `lib/watch-connectivity/tracking-payload.ts` - Current watch payload shape to align into sync pipeline.
  - `lib/watch-connectivity.ios.ts` - Native payload sanitation and event mapping.
  - `docs/WATCH_APP_GUIDE.md` - Existing reachability assumptions and mirror cadence context.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: skew-window and degradation tests fail (`bun run test -- tests/unit/fusion/sync-and-degrade.test.ts`).
  - [x] GREEN: all 7 non-empty sensor states map to defined behavior.
  - [x] REFACTOR: sync strategy isolated from movement/cue logic.
  - [x] Scenario: `Timestamp skew guard`
    - Tool: Bash
    - Preconditions: sync tests include skew fixtures
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/sync-and-degrade.test.ts --testNamePattern="skew"`
      2. Assert `drops_stale_frame_when_skew_exceeds_threshold` passes
    - Expected Result: stale frames rejected, stream continues
    - Evidence: `.sisyphus/evidence/task-2-skew.txt`
  - [x] Scenario: `Degradation matrix coverage`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/sync-and-degrade.test.ts --testNamePattern="matrix"`
      2. Assert 7 scenario cases pass
    - Expected Result: deterministic fallback mapping
    - Evidence: `.sisyphus/evidence/task-2-matrix.txt`

  **Commit**: YES

- [x] 3. Implement calibration pipeline (neutral pose + device offsets + confidence scoring)

  **What to do**:
  - Build calibration state machine for neutral pose capture.
  - Compute watch/AirPods orientation offsets into camera frame.
  - Add calibration confidence score and recalibration trigger threshold.

  **Must NOT do**:
  - No long-running blocking calibration path.
  - No silent calibration failure.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: coordinate-frame mapping and quality gating are sensitive.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: guard against unstable calibration math and hidden side effects.
  - **Skills Evaluated but Omitted**:
    - `playwright`: not primary for calibration math.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 4, 5
  - **Blocked By**: 2

  **References**:
  - `lib/arkit/ARKitBodyTracker.ios.ts` - available joint/pose access points for neutral baseline capture.
  - `lib/arkit/overlay-mapping.ts` - existing transform inversion/clamping utilities and style.
  - `lib/pose/adapters/arkit-workout-adapter.ts` - canonicalization pattern for joint aliases.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: calibration math tests fail (`bun run test -- tests/unit/fusion/calibration.test.ts`).
  - [x] GREEN: neutral-pose offset and confidence tests pass.
  - [x] REFACTOR: calibration state transitions represented explicitly (no implicit booleans).
  - [x] Scenario: `Calibration success path`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/calibration.test.ts --testNamePattern="success"`
      2. Assert confidence output >= 0.85 for stable fixture
    - Expected Result: calibrated state reached with bounded offset values
    - Evidence: `.sisyphus/evidence/task-3-calibration-success.txt`
  - [x] Scenario: `Calibration drift trigger`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/calibration.test.ts --testNamePattern="drift"`
      2. Assert recalibration-required flag is set when drift threshold exceeded
    - Expected Result: explicit drift handling
    - Evidence: `.sisyphus/evidence/task-3-calibration-drift.txt`

  **Commit**: YES

- [x] 4. Build core fusion engine with single-pass feature computation and confidence fusion

  **What to do**:
  - Implement fusion tick: ingest -> align -> compute features once -> emit `BodyState`.
  - Fuse confidence from camera quality + watch/AirPods consistency signals.
  - Cache feature outputs for phase/cue consumers.

  **Must NOT do**:
  - No duplicate angle/geometry recomputation in phase/cue modules.
  - No direct dependencies from fusion core to screen components.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: central correctness and performance kernel.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: ensure architectural integrity of compute-once rule.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not needed for algorithm core.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 5, 6, 7
  - **Blocked By**: 1, 2, 3

  **References**:
  - `lib/pose/realtime-form-engine.ts` - existing smoothing and tracking quality update approach.
  - `lib/pose/shadow-metrics.ts` - existing comparison metric accumulation patterns.
  - `lib/pose/shadow-provider.ts` - provider selection/fallback sticky-state pattern.
  - `app/(tabs)/scan-arkit.tsx` - current frame loop and metric consumption flow.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: fusion engine tests fail (`bun run test -- tests/unit/fusion/engine.test.ts`).
  - [x] GREEN: feature cache and confidence logic pass tests.
  - [x] REFACTOR: one source of truth module exports geometric feature map.
  - [x] Scenario: `Compute-once enforcement`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/engine.test.ts --testNamePattern="compute once"`
      2. Assert `does_not_recompute_angles_for_cue_pass` passes
    - Expected Result: no duplicate math pass in same frame
    - Evidence: `.sisyphus/evidence/task-4-compute-once.txt`
  - [x] Scenario: `Low camera confidence fallback`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/engine.test.ts --testNamePattern="low camera confidence"`
      2. Assert mode transitions to degraded and cue severity reduced
    - Expected Result: graceful degradation without crash
    - Evidence: `.sisyphus/evidence/task-4-degraded.txt`

  **Commit**: YES

- [x] 5. Implement movement profiles and phase FSM for five movements

  **What to do**:
  - Define movement profiles: squat, hinge, lunge, horizontal press, vertical press.
  - Implement phase FSM transitions with hysteresis/debounce.
  - Add profile thresholds and per-phase metric targets.

  **Must NOT do**:
  - No profile-specific ad hoc logic in screen component.
  - No uncontrolled transition jumps.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: complex domain logic, high risk of false positives.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: verify transition safety and threshold reasonability.
  - **Skills Evaluated but Omitted**:
    - `playwright`: secondary until integration stage.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 6, 7
  - **Blocked By**: 1, 3, 4

  **References**:
  - `lib/services/workout-runtime.ts` - existing rep transition helper semantics.
  - `lib/workouts/index.ts` - workout mode registration conventions used by scan flow.
  - `tests/unit/workout-runtime.test.ts` - adaptive timing test idioms.
  - `app/(tabs)/scan-arkit.tsx` - existing `useWorkoutController` phase callback wiring.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: FSM tests fail (`bun run test -- tests/unit/fusion/phase-fsm.test.ts`).
  - [x] GREEN: valid transitions and threshold handling pass for all profiles.
  - [x] REFACTOR: profile thresholds isolated in movement config files.
  - [x] Scenario: `Valid transition graph`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/phase-fsm.test.ts`
      2. Assert `rejects invalid phase jump` and `counts rep on bottom_to_concentric` pass
    - Expected Result: deterministic FSM behavior
    - Evidence: `.sisyphus/evidence/task-5-fsm.txt`
  - [x] Scenario: `Profile parity check`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/profile-thresholds.test.ts`
      2. Assert all five profile fixtures evaluated and pass
    - Expected Result: all launch profiles defined and validated
    - Evidence: `.sisyphus/evidence/task-5-profiles.txt`

  **Commit**: YES

- [x] 6. Build cue engine (persistence, cooldown, priority arbitration, channel outputs)

  **What to do**:
  - Implement rule evaluation by phase and confidence.
  - Add persistence windows and cooldown controls to avoid spam.
  - Emit structured cues for speech/watch haptic/UI channels.

  **Must NOT do**:
  - No cue spam on single-frame noise.
  - No hardcoded cue text in integration screen.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: behavior-heavy state machine and user-facing outputs.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: verify anti-spam and severity ordering.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: cue logic first, UI styling later.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 7, 8
  - **Blocked By**: 4, 5

  **References**:
  - `app/(tabs)/scan-arkit.tsx` - current cue speech throttling and cue event logging patterns.
  - `lib/services/cue-logger.ts` - cue telemetry logging expectations.
  - `hooks/use-speech-feedback.ts` - speech feedback invocation model and min interval behavior.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: cue arbitration tests fail (`bun run test -- tests/unit/fusion/cue-engine.test.ts`).
  - [x] GREEN: persistence/cooldown/priority logic passes.
  - [x] REFACTOR: cue rule definitions externalized from execution engine.
  - [x] Scenario: `Cue persistence debounce`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/cue-engine.test.ts --testNamePattern="persistence"`
      2. Assert cue does not fire before required persistence window
    - Expected Result: jitter-resistant cueing
    - Evidence: `.sisyphus/evidence/task-6-persistence.txt`
  - [x] Scenario: `Cooldown spam prevention`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/cue-engine.test.ts --testNamePattern="cooldown"`
      2. Assert repeated violations emit one cue within cooldown interval
    - Expected Result: anti-spam behavior validated
    - Evidence: `.sisyphus/evidence/task-6-cooldown.txt`
  - [x] Scenario: `Priority arbitration and channel outputs`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/cue-engine.test.ts --testNamePattern="priority arbitration"`
      2. Assert only highest-priority cue emits and includes expected channel targets
    - Expected Result: deterministic arbitration with structured channel outputs
    - Evidence: `.sisyphus/evidence/task-6-priority.txt`

  **Commit**: YES

- [x] 7. Integrate fusion core into runtime screen and watch payload propagation

  **What to do**:
  - Wire fusion output into `scan-arkit` runtime loop.
  - Replace duplicated local angle/cue branching with fusion output.
  - Extend watch payload fields to include fusion confidence/degraded mode metadata.

  **Must NOT do**:
  - No large unrelated refactor in `scan-arkit.tsx`.
  - No breaking changes to existing watch payload backward compatibility.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: high-risk integration in central runtime screen.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: ensure minimal, scoped integration diff.
  - **Skills Evaluated but Omitted**:
    - `git-master`: commit hygiene handled separately.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: 8
  - **Blocked By**: 0, 4, 5, 6

  **References**:
  - `app/(tabs)/scan-arkit.tsx` - primary runtime integration point.
  - `lib/watch-connectivity/tracking-payload.ts` - canonical watch payload generator.
  - `lib/watch-connectivity.ios.ts` - message/context send path and sanitization.
  - `targets/watch-app/WatchSessionManager.swift` - consuming fields on watch side.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: integration tests fail before wiring (`bun run test -- tests/unit/fusion/runtime-integration.test.ts`).
  - [x] GREEN: runtime integration tests pass; existing watch payload consumers remain compatible.
  - [x] REFACTOR: legacy duplicated path removed or delegated to fusion output.
  - [x] Scenario: `Runtime integration happy path`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/fusion/runtime-integration.test.ts`
      2. Assert `publishes_tracking_payload_with_confidence` passes
    - Expected Result: fusion state reaches watch payload and runtime UI model
    - Evidence: `.sisyphus/evidence/task-7-runtime.txt`
  - [x] Scenario: `Backward-compatible watch payload`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/unit/watch/tracking-payload-compat.test.ts`
      2. Assert legacy fields (`isTracking`, `reps`, `tracking`) remain present
    - Expected Result: no watch parsing regression
    - Evidence: `.sisyphus/evidence/task-7-watch-compat.txt`

  **Commit**: YES

- [x] 8. End-to-end validation, performance budget checks, and CI pass criteria

  **What to do**:
  - Add integration/perf harness for latency and confidence outputs.
  - Add degradation matrix integration tests.
  - Run required project test commands and capture evidence artifacts.

  **Must NOT do**:
  - Do not weaken existing CI thresholds or skip test suites.
  - Do not rely on manual verification statements.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: broad verification across unit/integration/perf surfaces.
  - **Skills**: `code-reviewer`
    - `code-reviewer`: ensure verification covers correctness + reliability.
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: not needed for validation execution.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Final wave
  - **Blocks**: None
  - **Blocked By**: 6, 7

  **References**:
  - `package.json` - canonical project test commands and script names.
  - `etc/jest.config.js` - coverage collection and thresholds.
  - `.github/workflows/ci-cd.yml` - CI expectations for unit/e2e checks.
  - `tests/e2e/auth.flow.spec.ts` - Playwright project test style and selectors.

  **Acceptance Criteria (TDD + QA)**:
  - [x] RED: perf and integration tests initially fail where expected.
  - [x] GREEN: all newly added tests pass.
  - [x] REFACTOR: test utilities deduplicated and reusable.
  - [x] `bun run test -- --coverage` passes.
  - [x] `bun run test:e2e` passes for relevant flows.
  - [x] Scenario: `Latency budget`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/integration/fusion-latency.integration.test.ts`
      2. Assert p95 loop latency <= 150ms from output metrics
    - Expected Result: latency budget met
    - Evidence: `.sisyphus/evidence/task-8-latency.txt`
  - [x] Scenario: `Full degradation matrix integration`
    - Tool: Bash
    - Steps:
      1. Run `bun run test -- tests/integration/fusion-degradation.integration.test.ts`
      2. Assert all 7 non-empty sensor-state scenarios pass
    - Expected Result: robust failure-mode behavior
    - Evidence: `.sisyphus/evidence/task-8-degradation.txt`

  **Commit**: YES

---

## Commit Strategy

| After Task | Message | Verification |
|---|---|---|
| 0-1 | `feat(fusion): add capability gates and core contracts` | `bun run test -- tests/unit/fusion/capabilities.test.ts tests/unit/fusion/contracts.test.ts` |
| 2-3 | `feat(fusion): add sync pipeline and calibration engine` | `bun run test -- tests/unit/fusion/sync-and-degrade.test.ts tests/unit/fusion/calibration.test.ts` |
| 4-6 | `feat(fusion): implement core engine, movement FSM, and cue arbitration` | `bun run test -- tests/unit/fusion/engine.test.ts tests/unit/fusion/phase-fsm.test.ts tests/unit/fusion/cue-engine.test.ts` |
| 7 | `feat(scan): wire fusion output into scan runtime and watch payloads` | `bun run test -- tests/unit/fusion/runtime-integration.test.ts tests/unit/watch/tracking-payload-compat.test.ts` |
| 8 | `test(fusion): add integration and latency/degradation validation` | `bun run test -- --coverage && bun run test:e2e` |

---

## Success Criteria

### Verification Commands
```bash
bun run test -- --coverage
bun run test:e2e
bun run lint
bun run check:types
```

### Final Checklist
- [x] Camera remains canonical coordinate anchor.
- [x] Feature computation occurs once per frame and is reused.
- [x] Five movement profiles implemented with deterministic FSM transitions.
- [x] Cue engine enforces persistence + cooldown + priority.
- [x] Degradation matrix validated for all non-empty sensor states.
- [x] p95 fusion latency budget is met.

---

## Defaults Applied and Clarifications
- Interpreted "full 4-pack + press" as: squat, hinge, lunge, horizontal press, vertical press.
- Chosen runtime target remains iOS-first only for this plan.
- AirPods input is treated as motion/orientation + derived HR context, not raw PPG waveform.
