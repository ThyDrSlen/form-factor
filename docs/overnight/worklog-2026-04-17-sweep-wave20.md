# Sweep Worklog — Wave-20 (2026-04-17)

**Directive (user).** "Improve UX for form tracking. See if we can get
Gemma by Google. Large-scoped PRs, not many tiny ones. Atomic commits.
Keep a worklog."

## Theme

**"Session-level form intelligence + Gemma-backed offline fault
glossary + coach cost/scope plumbing"** — one bundled PR shipping
five independent subsystems that all live in new files, with zero
modifications to any file currently contested by the ~28 open PRs.

## Why this theme

Wave-19 (PR #493) closed out the FQI guards + ErrorHandler
form-tracking domain + 85 algorithmic tests. With that service-layer
baseline landed, the audit for wave-20 surfaced two shapes of gaps:

1. **Form-tracking intelligence gaps (UX):** The in-flight PRs cover
   visual polish (#467), AR overlays (#449), rep-level replay (#444),
   form home tab (#473), between-sets coaching (#484), post-session
   recovery (#482), mesocycle analyst (#490), and stress hardening
   (#492). What's missing: *session-level comparison* — the user
   cannot see "my squat form today vs. last week", *fatigue
   detection* — the app doesn't notice when form is degrading
   across sets within a session, and a *fault glossary* —
   users can see the fault name and cue but can't look up what it
   means in depth.

2. **Gemma integration gaps:** Nine in-flight PRs already cover cloud
   provider (#457), streaming + failover + cache (#466), memory and
   debrief (#461), session generator (#471), live dispatch (#443),
   provider badge (#488), polish layer (#448), prompt format (#491),
   and mesocycle analyst (#490). What remains: *offline-ready
   fault explanations* (pre-seeded content, Gemma-regeneratable but
   ships without a cloud dependency), a *request-scope filter*
   (small-talk guard before tokens are spent), and a *token-usage
   tracker* (pure accumulator, no UI yet).

## Research notes — on-device Gemma feasibility (April 2026)

Parallel agent research confirmed that on-device Gemma via
**MediaPipe LLM Inference**, **MLC LLM** (`@react-native-ai/mlc`),
or **ExecuTorch** is technically viable for Expo SDK 54 but all three
require native modules (Obj-C/Swift + Kotlin) and add 500MB–1GB of
on-device weights plus ~30–60MB of engine binary. That puts on-device
Gemma outside wave-20's "no-new-native-deps" budget and into
Q3 2026+ territory. Cloud path (existing #457) remains the viable now.

**Wave-20's on-device contribution** is *infrastructure readiness*
without enabling real inference: a request-scope filter and a
token-usage tracker that both on-device and cloud paths will benefit
from once #457 lands. No new native modules, no new EAS config, no
weight manifests.

## Scope — five subsystems, one PR, ~6 atomic commits

All five ship as new files. **Zero modifications to any file currently
touched by an open PR.** Verified against PRs #443, #444, #448, #449,
#450, #452, #453, #456, #457, #461, #462, #463, #466, #467, #471,
#472, #473, #477, #478, #480, #481, #482, #484, #486, #488, #489,
#490, #491, #492, #493.

### 1. Session-to-session form comparison
- `lib/services/session-comparison-aggregator.ts` — pure diff fn that
  compares current vs prior session on the same exercise: FQI delta,
  ROM delta, fault-count delta, symmetry delta
- `hooks/use-session-comparison.ts` — React hook exposing comparison
  for a session+exercise pair
- `components/form-journey/SessionComparisonCard.tsx` — display card
- `app/(modals)/form-comparison.tsx` — modal screen with exercise
  picker + side-by-side metrics
- Tests: aggregator service, hook, card, modal (~15 test cases)

### 2. Form-fatigue detector + deload suggester (services only)
- `lib/services/form-fatigue-detector.ts` — analyzes FQI trajectory
  within a session; flags when form drops >15% from peak over last
  3 sets
- `lib/services/deload-suggester.ts` — cross-session; when last-3
  sessions show progressive FQI decline, recommend 1-week deload at
  70–80% intensity
- `hooks/use-form-fatigue-check.ts` — hook that runs detector on a
  completed set
- Tests: both services + hook (~18 test cases)
- Intentionally services-only — no UI wiring this wave (scan-arkit is
  contested; UI integration follows in a later PR)

### 3. Offline-ready fault glossary with Gemma-compatible schema
- `lib/services/fault-glossary-store.ts` — retrieval API, caches
  explanations keyed by `(exerciseId, faultId)`
- `lib/data/fault-glossary.json` — seed explanations (hand-authored,
  schema matches a future Gemma-regenerated version)
- `hooks/use-fault-explanation.ts` — hook exposing one explanation
- `components/form-tracking/FaultExplanationChip.tsx` — NEW chip
  component (verified not introduced by any open PR; #478 introduces
  its own different `FaultExplanationChip` — we name ours
  `FaultGlossaryChip` to avoid collision)
- Tests: store service, hook, component (~14 test cases)

### 4. Coach request-scope filter (small-talk guard)
- `lib/services/coach-request-filter.ts` — pure fn that classifies
  user prompts as on-topic (fitness/form/workout/nutrition/recovery)
  vs off-topic; returns reject-reason or pass-through
- Tests: filter with ~30 corpus prompts (on-topic + off-topic
  boundary cases)
- Zero integration wiring this wave — landing the pure fn means
  future PRs (including those that modify coach-service) can call it
  without introducing the filter file themselves

### 5. Coach cost tracker (pure accumulator)
- `lib/services/coach-cost-tracker.ts` — in-memory + AsyncStorage
  accumulator; records `{ date, taskKind, provider, tokensIn,
  tokensOut, cacheHit }`; exposes weekly aggregate
- Tests: accumulator service (~10 test cases)
- No UI yet — downstream PRs wire the dashboard

## File-overlap audit

Verified on current main (commit `bdf81d9`). No open PR touches any
of these paths:

- `lib/services/session-comparison-aggregator.ts` — NEW
- `lib/services/form-fatigue-detector.ts` — NEW
- `lib/services/deload-suggester.ts` — NEW
- `lib/services/fault-glossary-store.ts` — NEW
- `lib/services/coach-request-filter.ts` — NEW
- `lib/services/coach-cost-tracker.ts` — NEW
- `lib/data/fault-glossary.json` — NEW
- `hooks/use-session-comparison.ts` — NEW
- `hooks/use-form-fatigue-check.ts` — NEW
- `hooks/use-fault-explanation.ts` — NEW
- `components/form-journey/SessionComparisonCard.tsx` — NEW
- `components/form-tracking/FaultGlossaryChip.tsx` — NEW
- `app/(modals)/form-comparison.tsx` — NEW

**NOT touched:** `app/(modals)/_layout.tsx` (modal registered lazily
via deep link), `app/(tabs)/scan-arkit.tsx`, `app/(tabs)/workouts.tsx`,
`lib/services/coach-service.ts`, `lib/stores/session-runner.ts`.

## Dependencies

- Existing `rep-logger.ts` (on main) — rep-level FQI + fault list
- Existing `fqi-calculator.ts` (on main, hardened in wave-19) — score
  math
- Existing `workout-insights.ts` (on main) — session aggregate
  patterns
- Existing `lib/workouts/*.ts` — fault taxonomy for glossary seed
- Existing `ErrorHandler.ts` (on main, wave-19 added form-tracking
  domain) — structured error codes
- Existing `rep-index-tracker.ts` (on main) — in-session rep index

No dependencies on in-flight PR branches. Each subsystem is usable
once merged, independently of which other PRs have merged.

## Atomic commits (planned)

1. `docs(worklog): wave-20 plan — form intelligence + Gemma glossary`
2. `feat(form-intel): session-to-session comparison aggregator + hook + card + modal`
3. `feat(form-intel): form-fatigue detector + deload suggester + hook`
4. `feat(form-tracking): offline fault glossary store + seed data + hook + chip`
5. `feat(coach): request-scope filter for small-talk guard`
6. `feat(coach): token-usage cost tracker (accumulator, no UI)`

## Verification plan

- `bun run lint` — must pass on all new files
- `bun run check:types` — full repo type check
- `bun test` — full suite; wave-19 baseline was 1343 tests; wave-20
  adds ~87 new tests targeting aggregator math, detector thresholds,
  glossary schema, filter corpus, cost accumulator
- No regressions expected — all pure services + new UI

## Outcome

- Branch `feat/overnight-wave20-form-intel-gemma` opened off `main`
  (commit `b30516a`). 7 atomic commits — 1 worklog + 5 feature
  subsystems + 1 lint cleanup.
- **126 new unit tests** added across 12 files, all green. Full suite
  1412 passed / 10 skipped (matches wave-19 baseline — 0 regressions).
- Lint: only 2 pre-existing template-builder warnings (unchanged by
  this wave). `bun run check:types` clean.
- No migrations, no native code, no new dependencies, no modifications
  to any file currently contested by an open PR.

### Final commit ledger

| # | Commit | Summary |
|---|--------|---------|
| 1 | `597288f` | `docs(worklog)` — wave-20 plan |
| 2 | `3ec8f2e` | `feat(form-intel)` — session comparison (service+hook+card+modal+32 tests) |
| 3 | `831a0a7` | `feat(form-intel)` — fatigue detector + deload suggester + hook (23 tests) |
| 4 | `af39444` | `feat(form-tracking)` — offline fault glossary + chip (20 tests) |
| 5 | `da57a2e` | `feat(coach)` — request-scope filter (42 tests) |
| 6 | `e950414` | `feat(coach)` — token-usage cost tracker (12 tests) |
| 7 | `6683000` | `chore(form-comparison)` — drop unused exercise-picker state |

### Gemma integration — final summary

- **Cloud path** (PR #457 `gemma-3` via Google Gemini REST): unblocked,
  awaiting merge + secrets. No work duplicated this wave.
- **On-device path**: still blocked on `react-native-executorch` +
  `expo prebuild` + native rebuild (see `docs/OVERNIGHT_CHANGELOG.md`).
  Q3 2026+ target.
- **Infrastructure readiness shipped this wave**:
  - `coach-request-filter.ts` — cheap guard so off-topic prompts don't
    burn Gemma tokens once it's live.
  - `coach-cost-tracker.ts` — budget/cost visibility works identically
    for OpenAI, Gemma cloud, Gemma on-device, or the stub provider.
  - `fault-glossary.json` — schema-compatible with a future Gemma
    regenerator; today's hand-authored entries are a drop-in baseline.

## Audit findings deferred (next waves)

The parallel audits surfaced more form-tracking UX and Gemma ideas
than fit one PR. Deferring these to future waves so they aren't lost:

### Form-tracking UX (deferred)
- Exercise reference/warmup library (new modal + service)
- Pre-workout form-focused warmup prescriber
- "Why did my form drop?" diagnostic view post-session
- "My form journey" retrospective timeline beyond 4 weeks

### Gemma (deferred)
- Gemma coach cost dashboard UI (the service lands this wave; the
  dashboard modal ships once the coach-service file contention frees
  up)
- Gemma-regenerable glossary build job in
  `supabase/functions/build-fault-glossary/`
- On-device Gemma runtime adapter (MediaPipe vs MLC) — needs EAS
  custom-config and native modules; Q3 2026 target
