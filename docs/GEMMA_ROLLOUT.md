# Gemma On-Device Coach — Rollout Runbook

## TL;DR

On-device Gemma is staged behind TWO gates:

1. `EXPO_PUBLIC_COACH_LOCAL=1` — master flag.
2. `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=N` — N% of users admitted to
   the local path (hashed, stable per user).

Cloud remains default. Ramp: **0% → 10% → 50% → 100%**. Rollback:
flip `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT` back to `0` (or
`EXPO_PUBLIC_COACH_LOCAL` back to unset) and ship an OTA.

## Preflight (once, before any ramp)

- [ ] PR-D merged and dev-client rebuilt with `react-native-executorch`.
- [ ] Real values filled into `assets/gemma/manifest.json`
      (`url`, `sha256`, `bytes`). The shipped placeholder causes
      `coach-model-manager.startDownload` to refuse.
- [ ] `bun run eval:coach-local` reports Safety parity within 5 pts of
      cloud on parity yaml. Output: `evals/output/coach-local-report.md`.
- [ ] TestFlight dogfood ≥ 48h with internal team at
      `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=100` — zero OOM,
      fallback rate < 10%, p50 TTFT < 400ms.

## Stage 1 — 10% cohort

1. Set `EXPO_PUBLIC_COACH_LOCAL=1` and
   `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=10` in production env
   (Expo / EAS secrets).
2. Ship an OTA via `eas update`.
3. Monitor for 72h:
   - `coach.local.fallback_reason` rate < 15% of local attempts.
   - `coach.local.safety_reject` total < 0.5% of local attempts.
   - `coach.local.oom` count = 0.
   - P50 `coach.local.ttft.ms` < 600.
   - User complaints: zero "coach feels different".

## Stage 2 — 50% cohort

- Only proceed if all Stage 1 metrics held for 72h.
- Bump `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=50` and ship OTA.
- Same monitoring window (72h).

## Stage 3 — 100% cohort

- Flip to `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=100`.
- Keep cloud as fallback for 2 weeks; do not delete the Edge Function.

## Rollback (any stage)

Fastest path: flip env and ship OTA.

- `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=0` — keeps flag on for
  diagnostics but routes everyone to cloud.
- `EXPO_PUBLIC_COACH_LOCAL` unset — short-circuits before the cohort
  gate; used for a full kill-switch.

OTA propagates within ~1h for active users. Cloud path is always
available.

## Telemetry dashboard pointers

Events emitted by `lib/services/coach-telemetry.ts`:

| Event | Panel |
|-------|-------|
| `coach.local.init.ms` | p50/p95 runtime boot time. |
| `coach.local.ttft.ms` | p50/p95 first-token latency. |
| `coach.local.tok_per_s` | Throughput distribution. |
| `coach.local.oom` | Sum — any non-zero = pause rollout. |
| `coach.local.thermal_skip` | Sum — high = rethink thermal heuristic. |
| `coach.local.fallback_reason` | Stacked by reason — should trend to `0` as runtime stabilises. |
| `coach.local.safety_reject` | Stacked by metric — any new metric is a regression. |
| `coach.local.context_tokens` | p50 should be < 400 (our budget). |
| `coach.local.rollout_bucket` | Histogram — verify cohort shape matches pct. |

Instrumentation is structured-log-only today; a downstream aggregator
(Sentry custom metrics / PostHog / Supabase logs) will pick these up
without code changes.

## Incident playbook

### P0 — Users seeing unsafe output

1. Flip `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT=0` immediately.
2. Ship OTA.
3. Capture the offending output (via `coach.local.safety_reject` or
   user report).
4. Add a new rule to `coach-safety.SAFETY_RULES` and a scenario to
   `evals/coach-local-parity.yaml`.
5. Re-run parity eval; only re-enable after it passes.

### P1 — Elevated fallback rate

1. Check `coach.local.fallback_reason` breakdown:
   - `runtime_unavailable` → weights not downloaded; check
     `coach-model-manager` logs.
   - `oom` → reduce cohort, investigate device class distribution.
   - `local_not_available` → sentinel; indicates PR-D swap broke.
2. If > 30%, drop cohort by 50% and ship OTA.

### P2 — Parity regression

1. Inspect `evals/output/coach-local-report.md` diff.
2. Identify which Safety metric regressed.
3. Tune system prompt clause in `lib/services/coach-prompt.ts`
   (mirror change to `supabase/functions/coach/index.ts`) or tighten
   `coach-safety.SAFETY_RULES`.
