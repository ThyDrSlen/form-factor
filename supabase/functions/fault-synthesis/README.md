# fault-synthesis Edge Function

Phase 0 of the Gemma rollout (see `docs/GEMMA_RUNTIME_DECISION.md`). Takes a
cluster of co-occurring form faults and returns a one-sentence root-cause
summary produced by Gemma 3.

## Contract

### Request (POST JSON body)

```json
{
  "exerciseId": "squat",
  "faultIds": ["shallow_depth", "forward_lean", "hip_shift"],
  "glossaryEntries": [
    {
      "faultId": "shallow_depth",
      "displayName": "Shallow Depth",
      "shortExplanation": "...",
      "whyItMatters": "...",
      "fixTips": ["...", "..."],
      "relatedFaults": ["forward_lean", "hip_shift"]
    }
  ],
  "setContext": { "repNumber": 7, "setNumber": 3, "rpe": 8 },
  "recentHistory": [
    { "faultId": "shallow_depth", "occurrencesInLastNSessions": 4, "sessionsSince": 0 }
  ]
}
```

The `glossaryEntries` array is the client's authoritative copy of the
relevant entries. Keeping them on the client avoids drift between the
bundled JSON and any server-side cache.

### Response (200)

```json
{
  "synthesizedExplanation": "These three faults usually trace back to ankle mobility — try 90s of ankle rockers before your next working set.",
  "primaryFaultId": "shallow_depth",
  "rootCauseHypothesis": "ankle mobility",
  "confidence": 0.82
}
```

`primaryFaultId` is guaranteed to be one of the submitted `faultIds` or
`null`. `confidence` is clamped to `[0, 1]`.

### Error responses

- `400` — malformed payload (missing exerciseId / faultIds, invalid JSON)
- `401` — missing or invalid Supabase auth header
- `429` — per-user rate limit (30 / minute)
- `500` — missing `GEMINI_API_KEY` or unexpected error
- `502` — upstream model unavailable or returned an invalid shape

The client runner (`lib/services/fault-explainer-edge.ts`) treats any
non-2xx as "fall back to static explainer", so the chip never disappears.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | — | Google AI Studio key with Gemma access |
| `FAULT_SYNTHESIS_MODEL` | no | `gemma-3-4b-it` | Any Gemma model served by the Gemini API |
| `FAULT_SYNTHESIS_MAX_TOKENS` | no | `240` | Output token cap |
| `FAULT_SYNTHESIS_TEMPERATURE` | no | `0.4` | Keep low so cross-user output stays consistent |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | yes | — | Standard Supabase function env |

## Deploy

```
supabase functions deploy fault-synthesis
supabase secrets set GEMINI_API_KEY=...
```

Optionally override the client's function name with
`EXPO_PUBLIC_FAULT_SYNTHESIS_FUNCTION` at app build time.

## Security notes

- Every user-supplied field is sanitized: ids are stripped to `[\w:-]`,
  free-text fields have control chars removed and are length-capped,
  numbers are clamped. This protects both the prompt and our own logs.
- `primaryFaultId` the model returns is validated against the submitted
  `faultIds` set — the model cannot inject new fault ids into the UI.
- System instruction explicitly blocks medical advice and meta-references
  (e.g. "as an AI…").
- Rate limit: 30 requests / 60 s / user.
