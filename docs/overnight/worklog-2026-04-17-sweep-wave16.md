# Sweep Worklog — Wave-16 (2026-04-17)

**Directive.** Continue improving form-tracking UX. Progress Gemma by Google.
Prefer **large-scoped PRs** over many tiny ones. Commits stay atomic.

## Context at start

- Wave-15 had just shipped PR #486 (pause/resume) and PR #488 (provider
  badge + rate-limit UX).
- 30+ open PRs already claimed most obvious surfaces. Strategy: audit for
  **gaps still unclaimed** rather than re-attack contested ground, then
  converge on a single large-scoped PR.
- Untracked `lib/tracking-quality/human-validation.ts`, `subject-identity.ts`,
  and companion stress fixtures in the working tree were duplicates of work
  already committed on `feat/451-tracking-stress-hardening` — left alone.

## Gap audit

Ran 4 parallel Explore agents with the full PR exclusion list:

- **Backend/services** — flagged *session-runner ↔ rep-logger integration
  missing* (logSet is never called) and *video-service loses sessionId
  context*. Also dead-code in form-quality-recovery, async-unawaited coach
  persistence, scattered type exports.
- **Frontend/UX** — mesocycle / weekly-to-monthly view (distinct from
  #473's daily/weekly), between-exercise transitions, share form wins,
  form-history zero-data onboarding, home-tab deload card.
- **Gemma state** — confirmed end-to-end chain is broken on main: coach
  edge function is hard-coded to OpenAI (`supabase/functions/coach/index.ts`
  line 154, ALLOWED_MODELS line 25-28 is GPT-only). #457 ships the Gemma
  cloud provider but until it merges Gemma remains unreachable. Drill-
  explainer in #482 is Gemma-ready via `focus='drill-explainer'` but no
  focus-dispatch exists yet in coach/index.ts.
- **Testing** — rep-logger error paths, session-runner ↔ rep-logger
  integration (same gap as backend), use-premium-cue-audio (300+ LOC,
  zero tests), no E2E for form-tracking, voice-mode hooks untested.

**Converging signal:** session-runner ↔ rep-logger integration flagged by
**two agents independently**. This is the upstream plumbing gap — all the
FQI-based downstream features in flight rely on data that isn't actually
being written. Fixing this is the highest-leverage move.

## External Gemma research

- Gemma 3 model IDs are live via Gemini REST (`gemma-3-4b-it`,
  `gemma-3-12b-it`, `gemma-3-27b-it`) — these are in PR #457's
  ALLOWED_MODELS.
- **Gemma 4 is also live** as of 2026-04 with two IDs: `gemma-4-31b-it`
  and `gemma-4-26b-a4b-it`. **Multimodal (image input) support.** Issue
  #485 tracks extending #457's allowlist.
- Follow-up note for future wave: Gemma 4's image input could power a
  form-tracking "visual silhouette review" surface — but that needs the
  #457 + #485 plumbing first. Out of scope here.

## Wave-16 plan

Single large-scoped PR: **"Session Telemetry Plumbing + Form Mesocycle
Insights + Gemma Analyst Focus"**. Keeps commits atomic. Addresses the
upstream plumbing gap AND ships a novel user-facing mesocycle surface
AND future-proofs a Gemma-ready focus handler so the analyst flips to
Gemma with zero client changes when #457 lands.

All new files + one additive edit (`app/_layout.tsx` 1-line mount,
`lib/services/video-service.ts` opt-in param). No migrations. No native
code. No new dependencies.

## Work log

### 16:00 — Parallel gap audit kicked off

Four Explore agents with full PR exclusion list. Complementary in-parallel:
WebSearch + WebFetch against Google's Gemma docs for the external API
reality.

### 16:45 — Audit findings consolidated

Convergence on session-runner ↔ rep-logger integration. Scoped wave-16 to
one cohesive 13-commit PR spanning:

1. Session telemetry binder (3 commits — pure core + hook + mount)
2. Video sessionId binding (2 commits — service + tests)
3. Mesocycle aggregator (2 commits — core + tests)
4. useFormMesocycle hook (2 commits — hook + tests)
5. FormMesocycleCard component (2 commits — UI + tests)
6. form-mesocycle modal screen (2 commits — screen + tests)
7. Gemma-ready mesocycle-analyst (2 commits — service + tests)

### 17:15 — Implementation + verification

Each commit independently type-clean and lint-clean against `origin/main`.
`bun run test` runs 1156 tests across 94 suites; all green (2 skipped
suites unrelated to wave-16).

**68 new tests across 8 new suites:**
- `tests/unit/services/session-telemetry-binder.test.ts` (10)
- `tests/unit/hooks/use-session-telemetry-binder.test.tsx` (4)
- `tests/unit/services/video-service-session-binding.test.ts` (11)
- `tests/unit/services/form-mesocycle-aggregator.test.ts` (14)
- `tests/unit/hooks/use-form-mesocycle.test.tsx` (5)
- `tests/unit/components/form-journey/FormMesocycleCard.test.tsx` (7)
- `tests/unit/services/coach-mesocycle-analyst.test.ts` (11)
- `tests/unit/screens/form-mesocycle.test.tsx` (6)

Zero regressions on the 1088 pre-existing tests.

## Directive fulfillment

- **"improve ux exp for form tracking"** — a 4-week mesocycle view is
  brand-new surface area (none of #473/#444/#477/#478 ships it), and the
  upstream plumbing fix means every other in-flight FQI feature actually
  gets data now.
- **"see if we can get gemma by google"** — Gemma 4 confirmed live via the
  Gemini REST endpoint with multimodal support (April 2026). Client-side,
  `coach-mesocycle-analyst.ts` mirrors the drill-explainer pattern:
  `focus='mesocycle-analyst'` so when #457's Edge Function dispatcher lands,
  the analyst routes to Gemma with a one-line swap. TODO(#454/#457) marker
  annotates the provider-label flip point. Filed issue #485 (previous wave)
  already tracks adding Gemma 4 IDs to the allowlist.
- **"large-scoped prs not so many tiny ones"** — one PR, 15 atomic commits,
  ~1,800 LOC + 68 tests.
- **"keep commits atomic"** — each commit passes `bun run check:types` and
  `bun run lint` independently.
- **"keep a worklog of main work"** — this file.

## Deferred

- Wiring the FormMesocycleCard into `app/(tabs)/index.tsx` (home) —
  collides with #473's `app/(tabs)/_layout.tsx` + `form.tsx` tab. A 3-line
  follow-up PR after #473 merges will drop the card onto either home or
  the form tab.
- Swapping `provider: 'cloud'` → `provider: 'gemma-cloud'` in
  `coach-mesocycle-analyst.ts` once #457's Edge Function annotates the
  provider back on the response. TODO(#454/#457) marker in the file.
- Building a visual (image-input) mesocycle review via Gemma 4's
  multimodal capability — blocked on #457 + #485 merging first.
- Promoting `sessionId` from `metrics` JSON into a first-class `session_id`
  column on the `videos` table. Requires a migration (overnight rule
  forbids). The service exports `extractSessionIdFromMetrics` so future
  analytics don't need the column either.

## Pre-flight conflict report

Checked all 35 open PRs for file overlap:

- `app/_layout.tsx` — also touched by #433 and #450. Our addition is
  one import + a `<SessionTelemetryBinder />` tag inside the font-ready
  branch. Trivial merge.
- `lib/services/video-service.ts` — **zero open PRs touch this file.**
- All other new files are under paths no other PR touches
  (`components/form-journey/`, `components/telemetry/`, `hooks/use-form-
  mesocycle.ts`, `hooks/use-session-telemetry-binder.ts`, `lib/services/
  form-mesocycle-aggregator.ts`, `lib/services/coach-mesocycle-analyst.ts`,
  `lib/services/session-telemetry-binder.ts`, `app/(modals)/form-mesocycle
  .tsx`).

Modal is auto-discovered by expo-router (`app/(modals)/_layout.tsx`
pattern already skips `form-quality-recovery.tsx`, `add-food.tsx`,
etc.) — no modal-layout edit required, avoiding the heavily-contested
`_layout.tsx` in #480/#478/#477/#473/#471/#467/#456/#444/#443.
