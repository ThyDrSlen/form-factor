# Overnight Changelog

Record of pure-TypeScript changes made by overnight/headless runs so
the daytime dev has a clear picture of what shipped and what was
deferred.

---

## 2026-04-16 — feat/429-gemma-coach-v2 — Gemma coach v2

**Issue**: #429 · **Parent epic**: #415 · **Builds on**: PR #420 (scaffold).

### Shipped

- `lib/services/coach-prompt.ts` — extracted 7 system-prompt clauses,
  `sanitizeName`, `sanitizeMessages`, `renderGemmaChat` (Gemma chat
  template). Test-locked against cloud Edge Function's `buildPrompt()`.
- `lib/services/coach-safety.ts` — regex-based post-generation filter
  mirroring eval-yaml Safety metrics; 180-word cap; throws
  `COACH_LOCAL_UNSAFE`.
- `lib/services/coach-context-enricher.ts` — pulls last N workouts
  from SQLite into a <400-token summary.
- `lib/services/coach-rollout.ts` — FNV-1a hashed cohort gate
  (`EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT`).
- `lib/services/coach-telemetry.ts` — 10 structured counters.
- `lib/services/coach-model-manager.ts` — pinned `.pte` manifest
  download + SHA-256 verify + Wi-Fi gate + prune. Ships with a
  placeholder manifest so `startDownload()` refuses until the ML team
  drops in real values.
- `lib/services/coach-local.ts` — scaffold with safety + context
  wiring (still throws `COACH_LOCAL_NOT_AVAILABLE`; PR-D swaps the
  throw for `runtime.generate`).
- `lib/services/coach-service.ts` — dispatcher now gates on BOTH flag
  and cohort, threads telemetry, and re-throws non-sentinel local
  errors.
- `evals/providers/coach-local-provider.mjs` + `coach-local-parity.yaml`.
- `scripts/eval-coach-local.ts` + `scripts/eval-coach-shared.ts`
  (shared `categorizeMetric` helper).
- `docs/gemma-integration.md` (new) + `docs/GEMMA_ROLLOUT.md` (new).

### Test coverage

- `coach-prompt.test.ts` — 20 tests (clause lock + eval yaml cross-check).
- `coach-safety.test.ts` — 19 tests.
- `coach-context-enricher.test.ts` — 14 tests.
- `coach-rollout.test.ts` — 16 tests.
- `coach-telemetry.test.ts` — 10 tests.
- `coach-model-manager.test.ts` — 20 tests.
- `coach-local.test.ts` — 9 tests.
- `coach-service.test.ts` — all 25 existing tests still pass + 5 new
  dispatcher tests.

### Deferred (daytime follow-up)

1. **`react-native-executorch` install** — requires dev-client
   rebuild; that's a native change so it's out of scope for overnight.
   Tracked in PR-D.
2. **Real `.pte` URL + sha256 + bytes** in `assets/gemma/manifest.json`.
   Needs ML team export pipeline to run.
3. **Replacing the `supabase/functions/coach/index.ts buildPrompt()`
   with a shared import** — the Edge Function path is in a hard-banned
   directory. Byte-for-byte literal test (`coach-prompt.test.ts`) keeps
   the two copies in lockstep until someone can touch the banned path.
4. **Real `runtime.generate()` call** inside `coach-local.ts` — PR-D
   one-liner swap. Safety + context + telemetry wiring is ready.
