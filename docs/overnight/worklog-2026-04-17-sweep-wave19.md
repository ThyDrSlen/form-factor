# Sweep Worklog — Wave-19 (2026-04-17)

**Directive.** Continue improving form-tracking UX. Progress Gemma by Google.
Prefer **large-scoped PRs** over many tiny ones. Commits stay atomic.

## Theme

"Form-tracking service robustness — FQI degenerate-range guards,
form-tracking error domain + structured codes, plus 85 algorithmic
edge-case tests"

## Why this theme

Four parallel audit agents (UX / Gemma / backend / testing) ran in
parallel against the codebase plus the list of 20+ in-flight PRs. The
audits converged on a class of issues no other PR addresses:

1. **Silent FQI corruption.** `calculateRomScore()` and
   `calculateDepthScore()` divided by `targetRom` and compared against
   `tolerance` without any sanity guard. If a workout config ships
   `range.max <= range.min` (degenerate ROM range) or `tolerance <= 0`,
   the math returns `Infinity` or negative deviations that `Math.min`
   silently clamps to `1` (= 100% perfect score). User sees a perfect
   score on a malconfigured workout. No warning emitted; no test
   covers it.

2. **`'form-tracking'` error domain doesn't exist.** `ErrorHandler.ts`
   enumerates `network | oauth | session | validation | camera | ml |
   storage | sync | auth | unknown`. Form-tracking failures land in
   `'unknown'` or `'validation'` — no structured codes for `subject
   not human`, `subject switch detected`, `calibration failed`, etc.
   This blocks dashboards/alerts from grouping the same failure mode
   across the pipeline and forces every form-tracking caller to invent
   ad-hoc copy.

3. **Visibility tier classification at exact thresholds.** `getVisibilityTier`
   /`getConfidenceTier` use hard-coded `0.3 / 0.6` cutoffs. No tests
   cover what happens at the exact boundary, with `NaN`, with
   `Infinity`, or with negative values — all of which can arrive from a
   degenerate ARKit confidence stream and silently flip a rep from
   `trusted` → `weak` mid-rep.

4. **`rep-logger` aggregation helpers have zero test coverage.**
   `calculateAvgFqi`, `buildFaultHistogram`, `calculateCuesPerMin`,
   `checkCueAdoption`, and `RepBuilder` are all pure functions that
   feed downstream analytics — and there were no tests at all.

Wave-19 ships fixes for #1 + #2 plus ~85 new tests covering #1 / #3 /
#4. All changes are pure-TS, no UI, no native code, no migrations, no
new dependencies. Zero file overlap with any of the 20+ open PRs except
a one-line addition in `ErrorHandler.ts` (PR #488 also adds a
`COACH_RATE_LIMITED` message there — clean diff merge).

## Outcome

- **PR #TBD** opened against main, atomic commits.
- 85 new unit tests, 0 regressions across the existing 1343-test
  baseline (FQI 122 → 137, ErrorHandler 0 → 11, visibility 0 → 35,
  rep-logger helpers 0 → 24).
- No migrations, no native code, no new dependencies.
- Zero lint errors / warnings on new files.

## Audit findings deferred (pulled out of scope for wave-19)

The audits surfaced more candidates than fit one PR. These shipped to
the issue tracker / future waves so they don't get lost:

- UX #1 — Analyze tab empty-state onboarding (P1)
- UX #2 — Rep countdown pre-announce (P1)
- UX #4 — Quick exit confirmation + auto-save snapshot (P1)
- UX #6 — Rep timeline jump-to-rep scrubber (P2)
- UX #7 — Form quality milestone notifications (P2)
- UX #8 — Workouts tab form-quality badge (P2)
- Gemma #1 — Multimodal form-check via camera snapshot (P1)
- Gemma #3 — Cost-aware model dispatch for tactical tasks (P0)
- Gemma #4 — Fitness domain safety filter (P1)
- Gemma #6 — Promptfoo Gemma provider for A/B eval (P1)
- Backend #3 — Session-runner orphaned rest-timer notification on
  background (P1, paired with #486 once that lands)
- Backend #4 — Coach-service single-retry persistence bug under
  transient failure (P1)
- Testing #2 — Cue hysteresis race conditions (P1, paired with #435)
- Testing #4 — Occlusion handler decay asymmetry (P1, blocked on PR
  #445 which already touches `occlusion.ts`)

## Files added/changed on this branch

```
lib/services/fqi-calculator.ts                                    (modified — guards)
lib/services/ErrorHandler.ts                                      (modified — domain + codes)
tests/unit/services/fqi-calculator-boundaries.test.ts             (new — 15 tests)
tests/unit/services/error-handler-form-tracking.test.ts           (new — 11 tests)
tests/unit/services/rep-logger-helpers.test.ts                    (new — 24 tests)
tests/unit/tracking-quality/visibility.test.ts                    (new — 35 tests)
docs/overnight/worklog-2026-04-17-sweep-wave19.md
```

## Not touched in this PR

- `supabase/migrations/` — no schema changes.
- `ios/`, `android/`, `modules/*/ios/`, `modules/*/android/` — no native code.
- No new dependencies.
- `lib/services/rep-logger.ts` — read-only (helper tests added but
  source untouched).
- Anything in `app/`, `components/` — no UI changes.
