## AI Coach Edge Function

Supabase Edge Function that powers the in-app Coach tab.

### Configure

1) Set secrets (replace with your key/model):
```
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  COACH_MODEL=gpt-5.4-mini \
  COACH_TEMPERATURE=0.6 \
  COACH_MAX_TOKENS=320
```

2) Serve locally:
```
supabase functions serve coach --env-file ./supabase/.env
```

3) Deploy:
```
supabase functions deploy coach
```

### Request / Response

**Request body**
```json
{
  "messages": [{ "role": "user", "content": "Plan a 30-minute push day" }],
  "context": { "profile": { "name": "Ava" }, "focus": "fitness_coach" }
}
```

**Response body**
```json
{ "message": "Here is a concise session..." }
```

### Notes
- Uses OpenAI chat completions; keep the key in Supabase secrets (never ship it in the app).
- Defaults: model `gpt-5.4-mini`, temperature `0.6`, max tokens `320`. Override with env vars.
- Basic CORS headers are included so Expo web/mobile can call it via `supabase.functions.invoke`.

### Streaming + Failover + Cache (issue #465)

The client `sendCoachPrompt(messages, ctx, opts?)` accepts an optional third
arg that opts into one or more behaviors. The original two-arg shape is
unchanged.

```
client (sendCoachPrompt opts)
  |
  |-- opts.stream === true / fn  ->  streamCoachPrompt -> POST coach-gemma?stream=1
  |                                  (NDJSON: {"delta":"..."}\n... {"done":true}\n)
  |                                  recorded: stream_chunks, stream_chunk_delay_ms_avg,
  |                                            stream_abort_count, last_ttft_ms
  |
  |-- opts.allowFailover === true ->  coach-failover.sendCoachPromptWithFailover
  |                                   primary: gemma  -> coach-gemma function
  |                                   on 429/5xx ->  secondary: openai -> coach function
  |                                   recorded: failover_used + by_provider
  |
  |-- opts.cacheMs > 0           ->  coach-cache.withCoachCache
  |                                  key = FNV-1a({prompt, focus, sessionId, shaper})
  |                                  AsyncStorage TTL + in-flight dedup map
  |                                  cache + failover compose: failover producer
  |                                  is the cached operation
  |
  +-- (no opts)                   ->  legacy supabase.functions.invoke('coach') path
```

**Streaming:** the edge-function streaming branch is gated by `?stream=1`; the
default (no flag) is the legacy synchronous JSON response. The Gemini SSE
adapter lives in `supabase/functions/coach-gemma/streaming.ts`.

**Failover:** retries on 429 + 5xx + transport failure (`status=0`). Does NOT
retry on other 4xx (caller errors).

**Cache:** keyed on the last user message + focus + sessionId + shaper flag.
Default TTL for `useCachedCoachPrompt` is 12h (auto-debrief). Set `cacheMs: 0`
to bypass entirely.

**Shaped streams:** `useShapedStreamCoach` composes `useStreamCoach` with
`createStreamShaper()` so consumers see only complete sentences in `buffered`;
the in-flight fragment is exposed as `pending` for typing-indicator UIs. The
shaper flag is folded into the cache key so shaped + raw responses never
collide.

### Cross-PR notes
- `lib/services/coach-telemetry.ts` is currently a stub — PR #431 owns the
  canonical eval-YAML-driven counter registry. The public surface
  (`recordCoachStream*`, `recordCoachFailoverUsed`, `getCoachTelemetrySnapshot`)
  is preserved so #431 can drop in its implementation without touching
  call sites.
- `lib/services/coach-output-shaper.ts` is currently a stub — PR #448 owns
  the synchronous heuristic; the streaming `shapeStreamChunk` shipped here
  is the canonical streaming logic.
- `supabase/functions/coach-gemma/index.ts` is owned by PR #457; the
  streaming adapter ships standalone via `streaming.ts` with a TODO(#454)
  for the `?stream=1` dispatch wire-up.
