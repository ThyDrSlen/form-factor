# Gemma Subsystem — Orientation

Single index for every Gemma-adjacent piece on this branch. Start here
when you inherit the work, review the PR, or want to extend a service.

Companion docs (don't duplicate, link):
- `GEMMA_RUNTIME_DECISION.md` — phased rollout rationale (Edge → Cactus → …)
- `GEMMA_INTEGRATION_POINTS.md` — per-service priority-ranked live-code hooks

## The 5 services

Each is independent. Each follows the same pluggable-runner pattern
(see "The runner pattern" below). Each has a deterministic static
fallback that ships today; an LLM runner plugs in later with zero
consumer changes.

| Service | Service module | Runner contract | Today's runner | Tests | Hook | UI | Eval report |
|---|---|---|---|---|---|---|---|
| Fault synthesis | `lib/services/fault-explainer.ts` | `FaultExplainer.synthesize(input)` | `staticFallbackExplainer` (wrapped by cache + edge at bootstrap) | `tests/unit/services/fault-explainer*.test.ts` | `hooks/use-fault-synthesis.ts` | `components/form-tracking/FaultSynthesisChip.tsx`, `app/labs/fault-synthesis.tsx` | `docs/evals/fault-synthesis-report.md` |
| Personalized cue | `lib/services/personalized-cue.ts` | `PersonalizedCueRunner.getCue(input)` | `staticPersonalizedCueRunner` | `tests/unit/services/personalized-cue.test.ts` | `hooks/use-personalized-cue.ts` | `app/labs/gemma.tsx` | `docs/evals/personalized-cue-report.md` |
| Watch signal translator | `lib/services/watch-signal-translator.ts` | `WatchSignalTranslator.translate(signals)` | `staticWatchSignalTranslator` | `tests/unit/services/watch-signal-translator.test.ts` | — | `app/labs/gemma.tsx` | `docs/evals/watch-translator-report.md` |
| Voice RPE parser | `lib/services/voice-rpe-parser.ts` | `parseRpeUtterance(text)` (pure function) | regex-only | `tests/unit/services/voice-rpe-parser.test.ts` | — | `app/labs/gemma.tsx` | `docs/evals/voice-rpe-report.md` |
| Cactus (on-device Gemma) | `lib/services/fault-explainer-cactus.ts` | `FaultExplainer.synthesize(input)` | stub — throws `CactusNotInstalledError` | `tests/unit/services/fault-explainer-cactus.test.ts` | — | — | — |

## The Edge Function path (Phase 0)

| Piece | File |
|---|---|
| Deno handler | `supabase/functions/fault-synthesis/index.ts` |
| Shared prompt | `supabase/functions/_shared/fault-synthesis-prompt.ts` (byte-mirror of `lib/services/fault-synthesis-prompt.ts`) |
| Drift-check | `scripts/check-supabase-shared-in-sync.ts` (wired into `bun run ci:local`) |
| Function README | `supabase/functions/fault-synthesis/README.md` |

The runner wrapping at bootstrap:
```
setFaultExplainerRunner(
  createCachingFaultExplainer(         // LRU + stats
    createEdgeFaultExplainer()         // Supabase → Gemini → graceful fallback
  )
)
```

If the Edge Function is unreachable or keyless, the runner transparently
falls back to `staticFallbackExplainer` so the chip never goes blank.

## The runner pattern (one service, one shape)

```ts
// 1. Define the contract
export interface FooRunner {
  run(input: FooInput): Promise<FooOutput>;
}

// 2. Ship a deterministic default
export const staticFooRunner: FooRunner = { /* pure logic */ };

// 3. Module-level singleton swappable at app init
let active: FooRunner = staticFooRunner;
export const getFooRunner = () => active;
export const setFooRunner = (r: FooRunner | null) => { active = r ?? staticFooRunner; };
```

Consumers only ever import `getFooRunner()`. Real LLM implementations
(Edge Function, on-device Cactus, or a mock in tests) install themselves
via `setFooRunner` and every call site picks them up.

## Deploy flow — Phase 0 Edge Function

```
bun run gemma:preflight                      # ✓ / warn / ✗ checklist
supabase link --project-ref <ref>            # if not already linked
supabase functions deploy fault-synthesis    # ships the Deno handler
supabase secrets set GEMINI_API_KEY=<key>    # grab at aistudio.google.com/apikey
SUPABASE_URL=… SUPABASE_ANON_KEY=… \
  bun run gemma:smoke                        # end-to-end verification
```

Preflight verifies local invariants (Supabase CLI, file shape, `_shared`
sync, handler shape). Smoke hits the deployed function with a canonical
3-fault payload and validates the response schema end-to-end.

## Cue rotation (live today, no Gemma required)

| Piece | File |
|---|---|
| Rotator utility | `lib/services/cue-rotator.ts` |
| Authored variants (25 base cues × 2–3 phrasings) | `lib/services/cue-rotator-variants.ts` |
| Tests | `tests/unit/services/cue-rotator.test.ts` |
| Live wire-up | `app/(tabs)/scan-arkit.tsx` — single-line wrap of `speakCue(...)` + `isTracking` reset effect |
| Companion: `CueRule.messageVariants` in the `cue-engine` | `lib/fusion/cue-engine.ts` (separate abstraction, additive) |

Every `messages.push(...)` base string in `lib/workouts/*.ts` has ≥ 2
authored variants. The rotator is a strict-match lookup — unknown bases
fall through unchanged, so adding a new base string never breaks output
(it just misses the variety until someone authors phrasings).

Adding new variants: edit `cue-rotator-variants.ts`, run
`bun run test -- tests/unit/services/cue-rotator.test.ts`. The
coverage-floor test will fail loudly if you accidentally delete an entry.

## Lab screens (dev-only discoverability)

| Route | What it exercises |
|---|---|
| `/labs/fault-synthesis` | Three hand-picked fault clusters, cache-stats footer (hits/misses/evictions/hit-rate), `Inspect mode` + low-confidence toggle |
| `/labs/gemma` | Voice-RPE live text input + examples, personalized cue by (exercise × fault × history), watch-translator numeric-stepper sandbox |

Entry in `app/(tabs)/profile.tsx` under the `__DEV__`-gated debug row.

## Scripts (one-command tooling)

Everything lives under the `bun run gemma:*` namespace — see `package.json`.

| Command | Purpose |
|---|---|
| `bun run gemma:reports` | Regenerate all 4 eval reports in one pass |
| `bun run gemma:preflight` | "Am I ready to deploy?" checklist |
| `bun run gemma:smoke` | "Did my deploy work?" end-to-end test (requires `SUPABASE_URL` + `SUPABASE_ANON_KEY`) |
| `bun run gemma:check-sync` | Drift check for mirrored modules (runs in `ci:local`) |
| `bun run gemma:check-coverage` | Variant-coverage check for live workout cues (runs in `ci:local`) |
| `bun scripts/synthesis-report.ts --gemma` | Side-by-side static + Gemma (requires `GEMINI_API_KEY`) |

## Eval reports

Every service has a deterministic golden-file snapshot under
`docs/evals/`. `git diff docs/evals/` is a regression baseline. Reports
are regenerable via `bun run gemma:reports`. Rough edges in the current
static output are left visible so the team can judge concretely where
Gemma needs to win to justify the deploy cost.

| File | Cases |
|---|---|
| `docs/evals/fault-synthesis-report.md` | 31 clusters × 8 exercises |
| `docs/evals/voice-rpe-report.md` | 23 utterances |
| `docs/evals/personalized-cue-report.md` | 13 cases |
| `docs/evals/watch-translator-report.md` | 12 cases |

## Extending the subsystem — a checklist

Adding a new LLM service (e.g. "nutrition note parser"):

1. Service module: `lib/services/<name>.ts` with runner interface + static default + singleton get/set.
2. Tests: `tests/unit/services/<name>.test.ts` covering the static path + runner swap.
3. If it has client UI: React hook + labs-screen section in `app/labs/gemma.tsx`.
4. If it has a server-side runner: an Edge Function at `supabase/functions/<name>/` and mirrored prompt in `supabase/functions/_shared/<name>-prompt.ts` (add it to `MIRROR_PAIRS` in `scripts/check-supabase-shared-in-sync.ts`).
5. Eval report generator: `scripts/<name>-report.ts` + output at `docs/evals/<name>-report.md`. Add to the umbrella array in `scripts/gemma-reports.ts`.
6. Update this document's service table.
