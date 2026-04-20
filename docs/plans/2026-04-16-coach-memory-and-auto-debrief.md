# Coach Memory + Auto-Debrief Architecture

Landed in PR for issue #458. Two features, one PR, because they share the
edge-function injection surface, AsyncStorage namespace, and coach-service
wiring.

## Part A — Cross-session coach memory

### Intent

The coach used to start every `sendCoachPrompt()` with zero state. This
feature gives the model a short "what happened recently" clause so
programming advice stays consistent across sessions without requiring
cross-device sync.

### Data flow

```
[workout_sessions]            [SessionBrief]          [Edge Fn coach]
  Supabase            ->      AsyncStorage    ->      system message
     |                         (device-local)              |
     |                                                     |
  coach-memory-context    -> coach-memory         -> coach-service
  buildWeekSummary()         cacheSessionBrief()     sendCoachPrompt()
  synthesizeMemoryClause()
```

1. `coach-memory.ts` — AsyncStorage wrapper: `SessionBrief` per session,
   one `TrainingWeekSummary`, 30-day TTL, scoped `clearSessionMemory`.
2. `coach-memory-context.ts` — queries last 7/30d `workout_sessions`,
   infers phase (`recovery | building | peaking | unknown`) from avg RPE
   and volume trend. Synthesizes a <=5 sentence `MemoryPromptClause`.
3. `coach-service.ts` — `sendCoachPrompt()` prepends the clause as an
   additional system message behind `EXPO_PUBLIC_COACH_MEMORY=true`. Also
   re-injects the clause into the outgoing context so the edge function
   receives it.
4. `supabase/functions/coach/index.ts` — `buildPrompt()` reads
   `context.memoryClause`, sanitizes via the existing `sanitizeName`
   allowlist (widened to permit prose punctuation), caps at 600 chars, and
   prepends as a second system message.

### Feature flag

`EXPO_PUBLIC_COACH_MEMORY` — default `true`. Disable by setting to `false`.

### Deferred

- Supabase-backed cross-device memory (needs RLS design).
- Program-phase UI picker.
- Structured rep-level memory alongside the coarse `SessionBrief`.

## Part B — Auto-authored Gemma session debrief

### Intent

Right after `finishSession()` fires, generate a personalized coaching
brief the user did not have to ask for. The debrief appears proactively
via `AutoDebriefCard` (screen mount owned by #456).

### Data flow

```
SessionRunner.finishSession()
     |
     v
emitSessionFinished(event) --[listener fanout]--> use-auto-debrief (hook)
                                                       |
                                                       v
                                                buildInput(event) ->
                                                generateAutoDebrief ->
                                                   prompt (debrief-prompt) ->
                                                   provider resolve ->
                                                   sendCoachPrompt ->
                                                   output shaper ->
                                                   AsyncStorage cache
```

### Building blocks

- `coach-debrief-prompt.ts` — DebriefAnalytics + derivations (FQI slope,
  top fault, max symmetry, tempo slope), then `buildDebriefPrompt`
  emits a [system, user] pair targeting 150–250 words.
- `coach-auto-debrief.ts` — orchestrator: feature flag, cache, provider
  resolver, dispatch (with gemma->openai fallback), inline shaper, cache
  write.
- `session-runner.ts` — additive `onSessionFinished` listener registry
  (module-scoped). `finishSession()` fans out after the existing
  `session_completed` event so store state is already post-session.
- `hooks/use-auto-debrief.ts` — React hook: subscribes, surfaces
  `{data, loading, error, retry}`, preloads cached brief by sessionId.
- `components/form-tracking/AutoDebriefCard.tsx` — stateless render:
  loading skeleton / error + retry CTA / empty placeholder / shaped
  brief with provider badge.

### Feature flag

`EXPO_PUBLIC_COACH_AUTO_DEBRIEF_ENABLED` — default `true`. Disable by
setting to `false`; `generateAutoDebrief` throws immediately and the
hook is inert.

### Cross-PR stubs

| Stub | Canonical home | TODO marker |
|---|---|---|
| `computeFqiTrendSlope` | `@/lib/workouts/rep-insights.calculateRepFqiTrend` from #444 | `TODO(#437)` |
| `summarizeAnalyticsForPrompt` | `@/lib/services/coach-live-snapshot.summarizeForPrompt` from #443 | `TODO(#439)` |
| `shapeBriefOutput` | `@/lib/services/coach-output-shaper.shapeReply` from #448 | `TODO(#446)` |
| `resolveCloudProvider` + dispatch | `sendCoachGemmaPrompt` from #457 | `TODO(#454)` |
| coach-gemma edge function memory clause | `supabase/functions/coach-gemma/index.ts` from #457 | Land in a follow-up once #457 merges |

### Deferred

- Mount in `app/(modals)/form-tracking-debrief.tsx` — owned by #456.
- Supabase `coach_auto_debriefs` table (needs migration).
