# Gemma Integration

This doc describes Form Factor's Gemma / coach-service integration surfaces.
Today's landing PR (#468) adds **pre-session / pro-active** generators — session,
warmup, cooldown, rest advisor, and a JSON-mode parser + offline fallback.

## Session generator

Pre-session generators live under `lib/services/` and hooks under `hooks/`. All
four use the same dispatch contract: they call through `coach-service.sendCoachPrompt`
(with an injectable `dispatch` override for tests and future provider routing),
parse the response via `parseGemmaJsonResponse`, and fall back gracefully on
failure.

### Generator catalog

| Surface | Service | Prompt | Hook |
|---|---|---|---|
| NL workout session | `lib/services/session-generator.ts` | `session-generator-prompt.ts` | `hooks/use-session-generator.ts` |
| Pre-session warmup | `lib/services/warmup-generator.ts` | `warmup-generator-prompt.ts` | `hooks/use-warmup-generator.ts` |
| Post-session cooldown | `lib/services/cooldown-generator.ts` | `cooldown-generator-prompt.ts` | `hooks/use-cooldown-generator.ts` |
| Rest duration advisor | `lib/services/rest-advisor.ts` | (inline) | `hooks/use-rest-advisor.ts` |

### Gemma response shapes

Every generator uses a zod-lite schema from `lib/services/gemma-json-parser.ts`.
Shapes exported from each service are authoritative:

- **Session** — `GeneratedTemplateShape` with `{ name, description, goal_profile, exercises: [{ exercise_slug, sets: [{ target_reps, target_seconds, target_weight, target_rpe, set_type }], default_rest_seconds, notes }] }`.
- **Warmup** — `WarmupPlan` with `{ name, duration_min, movements: [{ name, duration_seconds, reps, focus: "mobility"|"activation"|"cardio"|"breathing", intensity: "low"|"medium"|"high" }] }`.
- **Cooldown** — `CooldownPlan` with same movement shape as warmup but `focus` in `{ "stretch", "breathing", "cardio", "activation" }`, plus optional `reflection_prompt`.
- **Rest advice** — `{ seconds, reasoning }`.

All schemas are validated via `schema.*` primitives in `gemma-json-parser.ts`.
Markdown fences are stripped, leading/trailing prose is recovered, and each
generator retries at least once on shape/syntax failure via a callback that
re-prompts the LLM with the validation issues.

### Fallback behavior

- `lib/services/session-generator-fallback.ts` ships a 12-entry deterministic
  session library (3 goal profiles × 4 duration buckets) plus default warmup /
  cooldown plans. Every entry is validated against the real schemas at test time.
- `withFallback(fn, fallback)` wraps any async generator so the UI always
  receives a usable result.
- `rest-advisor.ts` has its own inline `heuristicRestSeconds` fallback so it does
  not depend on the session-generator-fallback module.

### UI entry points

- **Template Builder** (`app/(modals)/template-builder.tsx`) — "Generate from AI"
  button shows for new (non-editing) templates; routes to the generate modal.
- **Templates list** (`app/(modals)/templates.tsx`) — sparkle icon in header
  opens the same modal.
- **`app/(modals)/generate-session.tsx`** — the modal itself. Takes intent + goal
  + duration, hydrates into the real `WorkoutTemplate` tree, resolves
  `exercise_slug` to local exercise_id via case-insensitive name match, persists
  via `genericLocalUpsert`, and opens the builder on the new templateId.

### Prompt engineering notes

- Few-shot exemplars live in `lib/services/template-generation-few-shots.ts` —
  indexed by domain with scoring by `goalProfile` + `durationMin`.
- System prompts emphasize JSON-ONLY output and warn against invented loads /
  unsafe volume.
- Retries include the previous response + validation issues so the LLM can
  self-correct.

## Cross-PR TODO

The following stubs / assumptions are in place for future PRs:

- **#466 Gemma streaming / provider routing** — when merged, replace direct
  `sendCoachPrompt` calls with the provider-routing dispatcher so sessions
  generated on-device use Gemma rather than the cloud coach. The `dispatch`
  override in every generator runtime makes this a 1-call-site change per
  generator.
- **#454 coach-gemma-service.ts** — currently not on `main`. Services use the
  cloud coach as a single dispatcher; on merge, wire `generateSession` /
  `generateWarmup` / `generateCooldown` / `suggestRestSeconds` to route via
  the Gemma provider first with cloud as a secondary fallback.
- **#465 `response_format: json_object`** — `supabase/functions/coach/index.ts`
  does not currently force JSON mode for Gemma requests. Once that PR adds a
  conditional `response_format` bit, the `maxRetries: 1` default in each
  generator runtime can be dropped to 0.
- **#434 exercise-swap suggester** — deferred; overlaps `workout-session.tsx`
  swap surface owned by #434.
- **Exercise slug resolution** — today uses loose name-contains matching in
  `app/(modals)/generate-session.tsx`. A future exercise-catalog PR should add
  a first-class `slug` column + canonical lookup so the generator can round-trip
  without dropping unresolved slugs.
