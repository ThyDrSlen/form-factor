# Gemma Runtime — Decision Doc

Status: Decided (2026-04-17). Scope: where Gemma runs to serve the fault-synthesis feature (and future on-device LLM workloads) in the RN app.

## Workload shape

First target is the **fault-synthesis chip** defined in `lib/services/fault-explainer.ts`. Each call:

- Prompt: ~250 tokens (fault list + glossary snippets + recent history summary)
- Output: < 80 tokens (one sentence + short root-cause hint)
- Call rate: 2–5× per set, mostly clustered around the post-rep UI update
- Latency budget: < 800 ms before the chip feels laggy relative to rep detection
- Offline: nice-to-have, not a hard requirement for the first rollout

Future workloads likely to share the runtime: RPE voice capture summarization, personalized cue narration against user history, fault-glossary regeneration offline.

## Candidates evaluated

| Runtime | Model | Bundle | Offline | iOS | Android | Web | Streaming |
|---|---|---|---|---|---|---|---|
| Cactus (native) | Gemma 3n E2B / E4B (GGUF) | ~1.2 GB download | Yes | Yes | Yes | No | Yes |
| MediaPipe LLM Inference | Gemma 3 / 3n | ~800 MB download + ~10 MB SDK | Yes | Yes | Yes | No | Yes |
| Apple Foundation Models | Apple's own ~3B | 0 (system-provided) | Yes | iOS 26+ only | No | No | Yes |
| Supabase Edge Function → Vertex Gemma | Gemma-2-9B-IT or Gemma-3-4B-IT | 0 | No | Yes | Yes | Yes | Yes |

Apple Foundation Models is excluded from the "Gemma" framing the user specified — it does not run Gemma. Kept in the table for future reference only.

## Decision

Ship in three phases. Phase 0 is the only one committed now; Phase 1 is contingent on Phase 0 usage data, Phase 2 is an optimization.

### Phase 0 — Edge Function runner (ship now)

Back the `FaultExplainer` interface with a Supabase Edge Function that calls Gemma on Vertex AI.

Why first:
- 0 app bundle impact. Ships through EAS in a single OTA update.
- Matches the existing `coach-service.ts` pattern — same auth, same error shapes, same observability.
- Validates the product hypothesis (does the synthesis chip actually improve user outcomes?) before we commit to model-download UX.
- Latency is acceptable for the ~800 ms budget on any non-rural network.
- Cost is bounded: < 80 output tokens × a few calls per set × DAU is trivial Gemma pricing.

Cost of this choice:
- Network-dependent. The static fallback already handles offline gracefully, so the UX degrades to the current static chips — not worse than today.
- Adds Edge Function LOC + Vertex credentials to manage.

### Phase 1 — Cactus on-device runner (ship after Phase 0 validates)

Add a second `FaultExplainer` implementation backed by Cactus with Gemma 3n E2B. Install it at app init when the device has the model cached; fall back to the Edge Function runner when not.

Why Cactus over MediaPipe:
- First-class TypeScript bindings. The user's reference `cactus_init` signature shows tool calls, tool RAG, and `confidence_threshold` + `cloud_handoff` — the cloud-handoff primitive is exactly the shape we already want (local Gemma first, Edge Function second).
- MediaPipe requires hand-wrapping ObjC + Kotlin SDKs for RN, which is engineering drag for no clear model-quality win.

Cost of this choice:
- 1+ GB download gated behind user consent. First-run UX needs a "download coach model" flow.
- EAS build size and native module maintenance.

### Phase 2 — Opportunistic only

Revisit MediaPipe or Apple FM **only** if Phase 0/1 reveal a concrete gap: e.g. if iOS 26+ devices show meaningfully better results with the bundled Apple model and we decide model-parity is acceptable to drop. No work until data says so.

## Interface stability

The `FaultExplainer` interface in `lib/services/fault-explainer.ts` is the commitment point. All three runtimes (static fallback, Edge Function, Cactus) must implement it without changes to consumers. A consumer never imports a specific runner — it imports `getFaultExplainer()` and installs one at app init via `setFaultExplainerRunner()`.

## Open questions

- Vertex region + token budgets for the Edge Function (to be set when implementing).
- Whether to tier by `confidence` on the Edge Function response — Vertex Gemma can self-report; Cactus does too. The interface already carries a `confidence` field, so nothing blocks this.
- Telemetry: reuse `coach-cost-tracker.ts` pattern or split into a new tracker scoped to synthesis calls.
