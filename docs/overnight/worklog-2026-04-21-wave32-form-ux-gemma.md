# Wave-32 Worklog — Form-UX + Gemma (2026-04-21 overnight)

## Goals
- Improve UX for form-tracking (ARKit scan, live session, calibration, debrief, FQI).
- Continue Gemma/Gemini surfacing work (user visibility, reliability, telemetry correctness).
- Large-scoped PRs, atomic commits (per prior feedback: bundle related fixes).
- Maintain worklog throughout the sweep.

## Starting state
- Branch at kickoff: `feat/wave31-gemma-user-surface` (clean).
- Wave-31 open PRs (from prior session): #565 form-UX polish, #566 Gemma user-surface, #567 test coverage.
- Wave-30 open PRs: #559 (Gemma edge hardening), #560 (test pack), #561 (calibration + session-polish pack).
- Upstream merge-pipeline: waves 28/29/30/31 all have PRs queued — assume these land before wave-32.

## Phase 1 — Audit plan
Four expert agents running in parallel from current working tree (read-only). Focus areas:

1. **Frontend Expert** — scan-arkit, live session UI, calibration, debrief, FQI widgets; state/re-render/stale closure/a11y/empty states.
2. **UX Expert** — end-to-end form-tracking journey (onboarding → scan → calibrate → session → debrief → history); friction, copy, confirmation, progress cues, missing context.
3. **Backend/Services Expert** — coach-service, gemma-dispatch, coach edge function, offline queue, cost tracker, telemetry/provider labeling.
4. **Testing Expert** — coverage gaps in form-tracking + Gemma: rep detector, calibration failures, streaming error paths, offline transitions, session resume, dispatch-flag gating.

Each agent returns 5–8 issues with title, description, priority, labels, file:line references.

## Phase 2 — Issue strategy
Deduplicate against the existing open-issues list. Prefer a small number of **umbrella** issues (one per theme) to match the large-scoped-PR preference. The umbrella issues gather the audit findings as nested checklists.

## Phase 3 — Implementation plan
Target **2–3 large-scoped PRs** (not a PR per finding):
- PR A: form-tracking UX pack (umbrella).
- PR B: Gemma + coach-surface reliability pack (umbrella).
- PR C (optional): test-coverage pack covering both themes.

Each PR uses atomic commits (one commit per logical change) with smart-commits style messages (`feat/fix(scope): summary` + Touches/Outcome/Notes body where relevant).

## Phase 4 — Verification
Per PR: `bun run lint`, `bun run check:types`, relevant test files. No new deps without justification. No native/migration/.env edits.

## Phase 5 — Logging
Append audit findings, issue numbers, PR numbers, and notable decisions below as we go.

---

## Audit findings (consolidated)

### Frontend (7 → 6 after dedupe)
- **F1** Stale closure in `hooks/use-auto-debrief.ts:160,202` — `runWith()` callback captures `buildInput` but subscription effect re-runs only when `buildInput` changes; session-finished listener may invoke stale input builder.
- **F2** Race in `app/(modals)/form-tracking-debrief.tsx:149-162` — `useSessionComparisonQuery` fires before async `userId` resolves; stale/empty comparison data possible.
- **F3/F7** Unsafe `router.push(... as \`/${string}\`)` cast in `components/form-tracking/FqiExplainerModal.tsx:95` and `form-tracking-debrief.tsx:161` — no validation on `exerciseId`, no try/catch.
- **F4** Haptic promise in `app/(modals)/form-tracking-pre-calibration.tsx:66-71` lacks mount-guard → `router.back()` may fire after unmount.
- **F5** No error boundary wrapping `form-tracking-debrief.tsx:276-288` session-comparison + auto-debrief cards; both failing leaves user with two broken cards and no retry.
- **F6** `hooks/use-auto-debrief.ts:169-185` cache-preload `setData` runs inside async without per-setState `cancelled` check (technically safe but fragile in StrictMode).

### UX (8)
- **U1** `app/(tabs)/scan-arkit.tsx:760` MediaPipe fallback toast copy is cryptic ("Pose tracking degraded — using fallback"). No persistence, no learn-more.
- **U2** `app/(modals)/form-tracking-pre-calibration.tsx:36-50` says "Checking your stance…" without explaining that low confidence = bad lighting/framing; failure offers no guidance.
- **U3** `app/(modals)/form-tracking-debrief.tsx` / `RepBreakdownList` — reps filtered out upstream are never disclosed in the summary ("12 reps · 1 excluded (confidence too low)").
- **U4** `components/form-tracking/FqiGauge.tsx` — SVG FQI gauge has no `accessibilityRole="progressbar"` / `accessibilityValue`; screen reader doesn't announce FQI threshold changes.
- **U5** `app/(tabs)/scan-arkit.tsx` reset-tracking / per-rep delete have no confirm modal; `ExitMidSessionSheet` only protects session exit.
- **U6** `components/form-tracking/TrackingLossBanner.tsx` — loss banner fades on recovery with no "Tracking recovered" announcement / persistent healthy indicator.
- **U7** `app/(tabs)/scan-arkit.tsx:755-760` — MediaPipe vs. ARKit provider not visible during session; user can't tell which is active.
- **U8** No keyboard shortcuts on iPad/web (Space/Esc/R for pause/exit/reset). Deferred — iPad isn't primary target for this wave.

### Backend / Services (8 — 4 map to existing open issues)
- **B1** `lib/services/coach-auto-debrief.ts:145-210` + `coach-drill-explainer.ts:86-135` don't pass `taskKind` to `sendCoachPrompt()` → dispatch falls back to `general_chat_default`, breaks cost-aware routing. *Partial #553.*
- **B2** `lib/services/coach-streaming.ts:45-56` — `StreamCoachResult` has no `provider`/`model` fields; streamed replies lose provider attribution. *Closes #538.*
- **B3** `lib/services/coach-cost-tracker.ts` has zero production call sites — `recordCoachUsage()` never invoked after coach replies. *Closes #537.*
- **B4** `lib/services/coach-offline-queue.ts:162-191` drain callback has no standardized taskKind propagation → replayed entries always miss dispatch.
- **B5** `lib/services/coach-drill-explainer.ts:94,126` — returns env-resolved provider instead of actual producer; misattributes Gemma wins. *Closes #539.*
- **B6** `coach-streaming.ts:260-308` — `streamGemmaViaNonStreamingFallback()` drops `reply.provider`/`reply.model` from Gemma response. (Related to B2.)
- **B7** `coach-cost-tracker.ts:154-160` and `coach-offline-queue.ts:94-103` — AsyncStorage failures swallowed with warning only; no retry; state silently lost.
- **B8** `coach-model-dispatch-flag.ts:21-25` — strict `'on'` match is correct but silent on typos (`'On'`, `'1'`) — no startup log to catch config drift.

### Testing (8)
- **T1** `coach-offline-queue` test covers storage CRUD only; no integration test through real dispatcher / reconnect flow.
- **T2** `coach-cost-tracker` doesn't exercise `QuotaExceededError` path explicitly.
- **T3** `coach-streaming` doesn't cover 408 timeout retryability or mid-stream malformed NDJSON.
- **T4** `coach-output-shaper` missing whitespace-only / emoji-heavy / unicode combining-mark edge cases.
- **T5** `app/(modals)/calibration-failure-recovery.tsx` has zero render tests across failure-reason enum.
- **T6** `lib/tracking-quality/rep-detector.ts` — confidence exactly at threshold / threshold−0.001 boundaries untested.
- **T7** `lib/tracking-quality/filters.ts` — `clampPointDelta` with Infinity, `sanitizeAlpha(NaN)` untested.
- **T8** `lib/fusion/phase-fsm.ts` — test file exists but thin (24 lines); `ALLOWED_TRANSITIONS` table-driven coverage missing.

## Dedupe summary
- B2 ↔ existing #538; B3 ↔ #537; B5 ↔ #539; B1 ↔ partial #553. PR body will close these.
- Not re-filing individual issues for those — umbrella will reference.
- Wave-29/30/31 open issues (#550–558, #562–564) are in-flight on PRs #555/#559/#560/#561/#565/#566/#567 — out of scope for wave-32.

## Issues to file
Three umbrella issues (one per theme), referencing the per-finding detail above.

## PRs planned
- **Wave-32 A — Form-UX polish pack** (6 frontend + 7 UX items). Branch: `feat/wave32-form-ux-polish-pack`.
- **Wave-32 B — Gemma/coach reliability + telemetry pack** (8 backend items, closes #537/#538/#539, partially #553). Branch: `fix/wave32-gemma-reliability-telemetry`.
- **Wave-32 C — Test coverage pack** (8 testing items). Branch: `test/wave32-form-gemma-coverage`.
Order of execution: B → A → C (service layer first; UI then consumes any contract updates; tests cover both).

## Issues filed
- #568 — wave-32 form-UX umbrella (13 items: F1–F6, U1–U7)
- #569 — wave-32 Gemma reliability + telemetry umbrella (B1–B8; supersedes #537/#538/#539/partial #553)
- #570 — wave-32 test-coverage umbrella (T1–T8)

## PRs opened

### PR #571 — `fix/wave32-gemma-reliability-telemetry` (7 atomic commits)
Service-layer Gemma/coach reliability + telemetry. Closes #537 #538 #539, partial #553.
1. `fix(coach): propagate taskKind from auto-debrief + drill-explainer to dispatcher` (B1)
2. `fix(coach): drill-explainer attributes reply to actual producer` (B5, closes #539)
3. `fix(coach): attach provider/model provenance to streaming replies` (B2+B6, closes #538)
4. `feat(coach): wire cost-tracker into service-layer call sites` (B3, closes #537)
5. `fix(coach-cost-tracker): retry AsyncStorage persist once before giving up` (B7, cost-tracker half)
6. `feat(coach-dispatch-flag): one-shot log on first evaluation` (B8)
7. `test(coach): update provider-dispatch fixtures for wave-32 B1 + B5` (fixture follow-through)

### PR #572 — `feat/wave32-form-ux-polish-pack` (4 atomic commits)
Form-tracking UX + correctness pack. Part of #568.
1. `feat(form-tracking): FQI gauge announces bucket changes to VoiceOver` (U4)
2. `feat(form-tracking): pre-calibration explains low-confidence + surfaces tip` (U2)
3. `fix(use-auto-debrief): stable session-finished subscription via ref` (F1)
4. `fix(form-tracking): catch router.push failures in debrief + FQI explainer` (F3/F7)

### PR #573 — `test/wave32-form-gemma-coverage` (3 atomic commits)
Test-coverage pack (+55 new tests). Part of #570.
1. `test(phase-fsm): table-driven coverage over allowed/rejected transitions` (T8, 2 → 35 tests)
2. `test(filters): NaN / Infinity guards on clampVelocity, smoothAngleEMA` (T7, +10 tests)
3. `test(coach-output-shaper): whitespace, emoji, unicode edge cases` (T4, +10 tests)

## Notes / decisions
- **Large-scoped PRs, atomic commits:** three PRs with 14 total commits. Matches prior-feedback preference (bundle over split).
- **All three PRs branch from `main`**, not from wave-31 — avoids cascading merge conflicts with in-flight PRs #565/#566/#567.
- **U8 (iPad keyboard shortcuts)** deferred — iPad isn't primary target this wave.
- **B4 (offline-queue dispatch integration)** deferred — `coach-offline-queue.ts` is introduced by wave-31 PR #566 and doesn't exist on main yet.
- **U1/U7 MediaPipe fallback copy + provider badge** and **U5 destructive confirm** deferred — both require touching `scan-arkit.tsx` (~3000 LOC) which has high merge-conflict surface with in-flight PRs.
- **U6 tracking-recovered a11y announcement** deferred — `TrackingLossBanner` has no `app/` consumer on main yet (wiring is in in-flight PRs); adding it here would be dead code.
- **F2 userId race** — on verification, `useSessionComparisonQuery` already guards `!userId` at the effect entry; not a real bug.
- **F4 haptic unmount guard** — verified: existing `return () => clearTimeout(timeout)` already cleans up; haptic promise resolves to void with no setState follow-up.
- **F6 cancelled guard in cache preload** — already correctly placed immediately before `setData`.
- **T6 rep-detector threshold boundary** — already covered by existing `visibility.test.ts` (196 lines, 40 tests including exact-threshold ULP checks).
- **T1/T2/T3/T5** deferred — T1 depends on #566 landing; T2 depends on B7 landing (#571); T3 and T5 are follow-up candidates.

## Verification
- `bun run lint` — green on all three branches
- `bun run check:types` — green on all three branches
- `bun run test` — 5063 pass / 25 skipped / 0 fail (up from 5008 on main before PR C)
- Pre-push policy + lint + types + audit hooks — green on all three branches

## Wave-32 delivered
- 14 atomic commits
- 3 large-scoped PRs (#571/#572/#573)
- 3 umbrella issues (#568/#569/#570) filed and referenced
- 4 existing issues on track to close on merge (#537/#538/#539; #553 partial)
- +55 new tests, 0 fixtures broken
