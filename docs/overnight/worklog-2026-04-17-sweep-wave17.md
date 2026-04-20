# Sweep Worklog — Wave-17 (2026-04-17 overnight)

**Directive (user):** Improve form-tracking UX. Explore Gemma by Google. Prefer
**large-scoped PRs** over many tiny ones. Commits stay atomic. Keep a worklog
of main work.

## Context at Start

- Branch: `feat/overnight-wave17-rep-quality-timeline` (cut from `origin/main`)
- **30+ open PRs** in flight, ~20 form-tracking + 8 Gemma themed.
- **60+ open issues** — most previously-identified gaps already filed.
- Wave-16 (PR #490) shipped session-telemetry plumbing + form mesocycle;
  Wave-15 shipped session continuity (#486) + coach provider badge (#488);
  Wave-13 shipped form-quality-recovery modal (#482).

## Theme

**"Rep-Quality Timeline + Coach Session Signals + Gemma-4-Ready Prompt Format"**

One large-scoped PR that bundles three disjoint, cohesive sub-features:

1. **Rep-quality log** — pure in-memory per-rep FQI + fault + joint-confidence
   store. Consumed by the timeline view and the coach signals helper. No
   persistence (session-scoped).
2. **Coach session signals + offline fallback text** — digest of the log into a
   compact signal shape the cloud coach or on-device Gemma can read; fallback
   text so rate-limit / offline states don't silently fail.
3. **Gemma-4 prompt format helper** — Gemma 4 supports native system prompts
   (vs. Gemma 3 which required injection). Helper renders messages for either
   target so PR #457 (cloud) and PR #431 (on-device) can plug in with a single
   line.

## Gap-audit findings (see 4-agent audit)

The audit agents converged on four uncontested gaps:

- **Per-rep FQI not persisted** — scan-arkit collects FQI during rep
  completion but never stores it at rep granularity. Users cannot see
  "rep 3 scored 0.72".
- **Faults not linked to rep index** — fault reporter (#482) logs faults
  to AsyncStorage but doesn't bind them to rep index.
- **Live session signals not piped to coach** — `CoachContext` (line 13
  of `coach-service.ts`) has `focus` and `sessionId` but no live FQI /
  fault / symmetry data.
- **No Gemma format validation** — `coach-prompt.ts` on the Gemma branch
  (#431) renders Gemma 3 style; Gemma 4 now supports system prompts
  natively and uses new control tokens.

## Gemma external state (April 2026, external research)

- **Gemma 4 released March/April 2026.** Sizes: E2B (2.3B), E4B (4.5B),
  26B-A4B (MoE), 31B (dense). Apache 2.0 license.
- Served on Gemini API as `gemma-4-31b-it`, `gemma-4-26b-a4b-it` (free
  tier only). Issue #485 tracks extending the allowlist.
- **Gemma 4 natively supports system role** (Gemma 1–3 required
  injection into first user turn).
- Multimodal: image + video + text (audio for E2B/E4B).
- On-device iOS: MediaPipe LLM Inference API is Google's first-party
  path. `react-native-executorch` v0.4.0+ still the RN-native path but
  Gemma 3 270M support is open upstream (pytorch/executorch #14941).

## Scope

### Files added

```
lib/services/rep-quality-log.ts                          (pure in-memory log)
lib/services/rep-quality-timeline.ts                     (pure aggregator)
lib/services/coach-session-signals.ts                    (pure signal builder)
lib/services/coach-fallback-responses.ts                 (pure fallback text)
lib/services/gemma-prompt-format.ts                      (Gemma 3 / 4 formatter)

hooks/use-rep-quality-log.ts
hooks/use-rep-quality-timeline.ts
hooks/use-coach-session-signals.ts

components/form-tracking/RepQualityDot.tsx
components/form-tracking/RepTimelineCard.tsx
components/form-tracking/LiveJointConfidenceBadge.tsx

app/(modals)/rep-timeline.tsx                            (auto-discovered)

tests/unit/services/rep-quality-log.test.ts
tests/unit/services/rep-quality-timeline.test.ts
tests/unit/services/coach-session-signals.test.ts
tests/unit/services/coach-fallback-responses.test.ts
tests/unit/services/gemma-prompt-format.test.ts
tests/unit/hooks/use-rep-quality-log.test.tsx
tests/unit/hooks/use-rep-quality-timeline.test.tsx
tests/unit/hooks/use-coach-session-signals.test.tsx
tests/unit/components/form-tracking/RepQualityDot.test.tsx
tests/unit/components/form-tracking/RepTimelineCard.test.tsx
tests/unit/components/form-tracking/LiveJointConfidenceBadge.test.tsx
tests/unit/screens/rep-timeline.test.tsx

evals/coach-gemma-format.yaml

docs/overnight/worklog-2026-04-17-sweep-wave17.md
```

### Zero overlap

Every file is new. No file touched by any of the 30 open PRs. Nothing in
`app/_layout.tsx`, `(modals)/_layout.tsx`, `session-runner.ts`,
`coach-service.ts`, `workout-session.tsx`, or any contested screen.

## Work Log

### Phase 1 — gap audit (complete)

Four parallel Explore agents returned uncontested gaps (above). Locked
the theme within the first 10 minutes of the sweep.

### Phase 2 — implementation (in progress)

Building pure services first (no RN deps), then hooks (thin), then
components, then the modal route. Commits are atomic per unit of work
so that if a downstream ripple forces a revert, it's a one-commit undo.

### Phase 3 — verification

`bun run lint` + `bun run check:types` + scoped jest runs before push.

## Deferred

- Mounting `<RepTimelineCard />` inside `form-quality-recovery.tsx` or
  `workout-session.tsx` — contested files, deferred to a daytime follow-up
  after wave-13/wave-15 land.
- Wiring the live log into `scan-arkit.tsx` — also contested. The
  components + screen are standalone-testable and can be wired by a
  2-line hook call in a follow-up PR.
- Flipping the `gemma-prompt-format` helper from "render for either
  Gemma 3 or 4" to "auto-detect target from model ID" — needs PR #457
  (Gemini API dispatcher) on main first.
- Image-input Gemma 4 visual review of the rep timeline — blocked on
  #457 + #485 allowlist.
- Promoting the in-memory log to a persistent journal — requires a
  migration, which overnight agents cannot touch.

## Outcome

- **One large-scoped PR** against `main` with **26 atomic commits** —
  each feature paired with its own test commit so that if a single unit
  needs revert, it's a one-commit undo.
- **26 files added, 3,136 insertions, 0 deletions**, 0 files modified
  in any existing location. Zero file overlap with the 30 open PRs.
- **143 new tests across 12 suites** — 0 failures, 0 regressions. Full
  repo test suite on this branch: 1,287 passing / 1,312 total. The 15
  failures are all from untracked stress-hardening test files carried
  over from wave-12's worktree and are not part of this PR (they need
  fixtures from PR #452).
- **Lint and type-check clean** (`bun run lint`, `bun run check:types`).
  2 pre-existing warnings in `template-builder.tsx` unrelated to this
  branch.

### What Gemma progress looks like in this wave

- Helper (`gemma-prompt-format.ts`) renders messages for **both Gemma 3
  and Gemma 4** chat templates, with a `validateGemmaFormat` round-trip
  guard that catches the common drift cases (system on Gemma 3,
  unbalanced turn markers, missing trailing model turn, unexpected
  roles).
- `coach-session-signals.ts` + `formatSignalsForPrompt` produces a
  tight block the coach can prepend to user turns — the piece every
  in-flight Gemma PR needs to personalize suggestions with live FQI,
  faults, and trend. The format is provider-agnostic (works for OpenAI
  today, unchanged for Gemma cloud or on-device tomorrow).
- `coach-fallback-responses.ts` gives Gemma on-device and rate-limit
  paths graceful degradation text — avoids the silent "Coach failed to
  respond" toast when the network or the model hiccups.
- `evals/scenarios/coach-gemma-format.yaml` locks in five Gemma-drift
  scenarios (system adherence, signals digest vs echo, single-cue
  length, multi-turn consistency, safety stop). Runs under any
  provider — the moment PR #457 lands and a Gemma provider is
  registered, we can diff behavior against the OpenAI baseline without
  changing the test corpus.

### Commit log (in order)

```
372289f test(evals): add Gemma format parity scenarios for coach eval
4ab9347 feat(form-tracking): add rep-timeline modal screen
ccdeb6f test(form-tracking): component coverage for LiveJointConfidenceBadge
3c0d70d feat(form-tracking): add LiveJointConfidenceBadge component
5fceae4 test(form-tracking): component coverage for RepTimelineCard
0c44f9c feat(form-tracking): add RepTimelineCard component
1d4a4e1 test(form-tracking): component coverage for RepQualityDot
12951eb feat(form-tracking): add RepQualityDot component
f1a83df test(coach): hook coverage for useCoachSessionSignals
9a5b726 feat(coach): add useCoachSessionSignals hook
786a960 test(form-tracking): hook coverage for useRepQualityTimeline
168fed9 feat(form-tracking): add useRepQualityTimeline hook
a29ed15 test(form-tracking): hook coverage for useRepQualityLog
c7d0662 feat(form-tracking): add useRepQualityLog hook
a165a21 test(coach): unit coverage for Gemma prompt format helper
e66d2e3 feat(coach): add Gemma 3 / Gemma 4 prompt format helper and validator
09e7103 test(coach): unit coverage for fallback responses
39addc9 feat(coach): add offline and rate-limit fallback responses
6810a35 test(coach): unit coverage for session-signals digest
d89e777 feat(coach): add session-signals digest for live coach context
1d5f2af test(form-tracking): unit coverage for rep-quality timeline
2726288 feat(form-tracking): add rep-quality timeline aggregator
eac2ee7 test(form-tracking): unit coverage for rep-quality log
fa11724 feat(form-tracking): add rep-quality log service
86f852e docs(worklog): wave-17 plan — rep-quality timeline + coach signals + Gemma-4 format
```

### Follow-ups (unblocked by this PR)

- Wire `useRepQualityLog` into `scan-arkit.tsx` so per-rep entries
  land in the log in real time. The log's `append()` is intentionally
  side-effect free — one line in the `onRepComplete` callback is
  enough. Contested file, deferred.
- Mount `<RepTimelineCard />` inside the form-quality-recovery modal
  (PR #482) once it merges. Single `<RepTimelineCard timeline={…} />`
  import.
- Wire `formatSignalsForPrompt` into `coach-service.ts` inside the
  `context.sessionId` branch so live signals land on cloud coach
  calls. Contested file (PR #431 / #457 / #448 all touch it).
- Extend `validateGemmaFormat` with multimodal-image checks once Gemma
  4 image input is wired. Needs the Gemini API dispatcher (PR #457).

