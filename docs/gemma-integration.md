# Gemma Integration — On-Device Coach

**Status**: Scaffold complete (this PR). Runtime landing deferred to PR-D.

This document covers the on-device Gemma-3-270m coach pipeline that
lives alongside the existing cloud coach (`supabase/functions/coach/`).
The goal is to move the most common coach turns to on-device inference
to cut latency, cost, and privacy exposure.

---

## 1. Goals

- Sub-second TTFT for the median coach turn.
- Zero outbound network calls for fitness_coach turns that qualify.
- Parity with the cloud coach on Safety and Format metrics (see
  `evals/coach-local-parity.yaml`).
- Graceful fallback to the cloud path when the device cannot run the
  model (OOM, thermal throttle, missing weights).

## 2. Architecture

```
                      ┌───────────────────────────────────────────┐
                      │  coach-service.sendCoachPrompt (dispatch) │
                      └───────────────────────────────────────────┘
                             │                         │
                EXPO_PUBLIC_COACH_LOCAL=1         cloud fallback
                & isInCohort(profile.id)               │
                             ▼                         ▼
             ┌────────────────────────────────┐   ┌──────────────────────┐
             │ coach-local.sendCoachPromptLocal│  │ supabase/functions/   │
             │  1. enrichCoachContext          │  │  coach/ Edge Function │
             │  2. renderGemmaChat             │  └──────────────────────┘
             │  3. runtime.generate  (PR-D)    │
             │  4. finalizeOutput (safety)     │
             └────────────────────────────────┘
```

## 3. Files

| File | Purpose |
|------|---------|
| `lib/services/coach-service.ts` | Dispatcher — picks between local and cloud based on flag + cohort gate. |
| `lib/services/coach-local.ts` | On-device provider. Today a stub, wired with context + safety hooks. |
| `lib/services/coach-prompt.ts` | Shared 7 system-prompt clauses, sanitisation, `renderGemmaChat`. |
| `lib/services/coach-safety.ts` | Post-generation regex filter mirroring eval-yaml Safety metrics. |
| `lib/services/coach-context-enricher.ts` | Pulls recent workouts from SQLite into a <400-token summary. |
| `lib/services/coach-rollout.ts` | FNV-1a hashed cohort gate. |
| `lib/services/coach-model-manager.ts` | Pinned `.pte` download + SHA-256 verify + prune. |
| `lib/services/coach-telemetry.ts` | Structured counters for init.ms, ttft.ms, oom, fallback_reason, etc. |
| `assets/gemma/manifest.json` | Pinned `.pte` metadata (placeholder URL/sha256/bytes today). |
| `evals/coach-local-parity.yaml` | Two-provider parity eval. |
| `scripts/eval-coach-local.ts` | Runs parity eval, writes report, exits non-zero on regression. |

## 4. Feature flags

| Flag | Default | Effect |
|------|---------|--------|
| `EXPO_PUBLIC_COACH_LOCAL` | unset | `=1` enables local attempts (subject to cohort gate). |
| `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT` | `0` | `0-100`; percentage of users allowed onto the local path. |
| `COACH_LOCAL_EVAL` | `0` | `=1` makes `coach-local-provider.mjs` call the real adapter (after PR-D). |

## 5. Runtime landing (PR-D — deferred)

The stub in `coach-local.ts` throws `COACH_LOCAL_NOT_AVAILABLE`. PR-D
will:

1. Install `react-native-executorch` and rebuild the dev client.
2. Export a `.pte` via Google's Executorch toolchain, then fill in real
   `url`, `sha256`, and `bytes` in `assets/gemma/manifest.json`.
3. Replace the throw in `coach-local.sendCoachPromptLocal` with:

   ```ts
   const raw = await runtime.generate(renderedPrompt);
   return finalizeOutput(raw);
   ```

4. Add a node adapter to `evals/providers/coach-local-provider.mjs`
   that can call the TS adapter (or a headless node wrapper) when
   `COACH_LOCAL_EVAL=1`.

Context enrichment, safety filtering, telemetry, cohort gating, and
model-manager downloads are already in place — PR-D is a surgical
swap.

## 6. Safety guarantees

Two layers:

1. **System prompt (prevention)** — the 7 clauses in
   `coach-prompt.SYSTEM_PROMPT_CLAUSES` steer the model. They are
   locked by `tests/unit/services/coach-prompt.test.ts` to match the
   cloud `buildPrompt()` byte-for-byte.
2. **Post-generation filter (defence)** — `applySafetyFilter` in
   `coach-safety.ts` rejects outputs that leak disallowed phrases
   (medical-diagnosis, push-through-injury, AI self-reference, etc.).
   Rejections throw `COACH_LOCAL_UNSAFE`; dispatcher catches and falls
   back to cloud. One regex rule per `not-contains` assertion in
   `evals/coach-eval.yaml`.

## 7. Telemetry

`coach-telemetry.ts` emits `[coach-telemetry] { event, value, ts }`
payloads. Dashboard pointers: see `docs/GEMMA_ROLLOUT.md`.

## 8. Performance budget (target, validated in PR-D)

| Metric | Budget |
|--------|--------|
| `coach.local.init.ms` (first boot) | ≤ 2000 |
| `coach.local.ttft.ms` (p50) | ≤ 400 |
| `coach.local.tok_per_s` (A17/M-class) | ≥ 20 |
| Memory peak | ≤ 250 MB |

## 9. Open questions (status)

- ~~Should on-device replace cloud for ALL turns, or only a subset?~~
  **Resolved**: on-device runs behind a hashed cohort gate
  (`isInCohort`). Cloud remains the default; users move onto local
  only when their profile.id hashes into the current cohort pct. This
  lets us ramp 0% → 10% → 50% → 100% while keeping a rollback to 0%
  one env flip away.
- Streaming tokens through the RN bridge — deferred to PR-D; the
  scaffold currently calls `runtime.generate` in blocking mode and
  `renderGemmaChat` ends with an open `model` turn so switching to
  streaming is a one-line adapter change.
- Multi-turn memory beyond the current session — out of scope for
  v2; the enricher reads SQLite workouts directly, no model-side
  memory state needed today.
