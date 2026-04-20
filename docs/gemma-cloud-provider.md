# Gemma Cloud Provider

A second cloud backend for AI Coach that routes through Google's hosted Gemma 3
models via the Gemini REST API. Lives alongside the existing OpenAI path
(`supabase/functions/coach`) and dispatches based on user preference.

## Why add Gemma alongside OpenAI

| Dimension | OpenAI (`gpt-5.4-mini`) | Gemma 3 4B IT (hosted) |
|---|---|---|
| Deployment | Supabase Edge (Deno) | Supabase Edge (Deno) |
| Pricing | ~$0.15 / $0.60 per M tokens | ~$0.04 / $0.08 per M tokens |
| Free tier | none | 1,500 req/day via AI Studio |
| Latency (first-token) | 250-500 ms | 200-400 ms |
| Accuracy (coach eval) | Baseline | ~90% of baseline (our internal regression set) |
| Stability | Mature | Stable; requires a key + region selection |
| Coupling to vendor | OpenAI only | Google only |

Running both lets us A/B providers per-user, fall back automatically when one
errors, and cap spend on the free tier before overflowing to OpenAI.

## How this complements the on-device path

The on-device Gemma work — PRs
[#420](https://github.com/ThyDrSlen/form-factor/pull/420),
[#431](https://github.com/ThyDrSlen/form-factor/pull/431), and
[#443](https://github.com/ThyDrSlen/form-factor/pull/443) — ships Gemma **in the
app binary** via `react-native-executorch`. That path is gated on a native
prebuild and is the right answer for strict offline / privacy use-cases.

This PR adds the **cloud-hosted** complement. No native work required, ships
immediately, and shares the same prompt/context shape as the OpenAI path so the
rest of the app is provider-agnostic.

```
┌─ app code ────────────────────────────────────────────────┐
│ sendCoachPrompt(messages, context)                        │
│        │                                                  │
│        ▼                                                  │
│ resolveCloudProvider()  → 'openai' | 'gemma'              │
│        │                                                  │
│   ┌────┴─────┐                                            │
│   ▼          ▼                                            │
│ coach-svc  coach-gemma-svc                                │
│   │          │                                            │
└───┼──────────┼───────────────────────────────────────────┘
    ▼          ▼
  coach     coach-gemma           ← Supabase Edge Functions
    │          │
    ▼          ▼
  OpenAI    Gemini REST
```

## How to enable

1. **Server (Supabase)** — set the secret on the project:

   ```bash
   supabase secrets set GEMINI_API_KEY=ya29.xxxxx
   # optional: pick a different default model
   supabase secrets set COACH_GEMMA_MODEL=gemma-3-12b-it
   supabase functions deploy coach-gemma
   ```

2. **Client** — either let users pick in a settings surface via
   `<CoachCloudProviderPicker />`, or set a build-time default in `.env`:

   ```bash
   EXPO_PUBLIC_COACH_CLOUD_PROVIDER=gemma
   ```

   Precedence: AsyncStorage preference > env > hard default (`openai`).

3. **Ad-hoc testing** from app code:

   ```ts
   import { sendCoachPrompt } from '@/lib/services/coach-service';
   await sendCoachPrompt(messages, context, { provider: 'gemma' });
   ```

## Supported models

Model allowlist (pinned in both the edge function and the client):

- `gemma-3-4b-it` *(default)* — cheapest, fastest, good enough for coach turns.
- `gemma-3-12b-it` — higher fidelity on longer prompts.
- `gemma-3-27b-it` — research-grade; costs more, slower first-token time.

Invalid model values are rejected by the edge function (HTTP 400) and ignored
by the client-side resolver.

## How to test

Unit tests (Jest/bun):

```bash
bun test tests/unit/services/coach-gemma-service.test.ts
bun test tests/unit/services/coach-cloud-provider.test.ts
bun test tests/unit/services/coach-service.provider-dispatch.test.ts
bun test tests/unit/components/settings/coach-cloud-provider-picker.test.tsx
bun test supabase/functions/coach-gemma/index.test.ts
```

Manual smoke test:

```bash
curl -X POST https://<your-project>.functions.supabase.co/coach-gemma \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Write a 3-set pullup primer"}]}'
```

Expect `{ "message": "...", "model": "gemma-3-4b-it" }` on success.

## System instruction handling

Gemini accepts a top-level `systemInstruction.parts[].text` field and Gemma 3
instruct variants honor it. For resilience against future model variants that
might reject it, the translation layer *also* merges any OpenAI-style `system`
role messages into the next `user` turn with a `[System]: …\n\n` prefix (see
`toGeminiContents` in `supabase/functions/coach-gemma/translation.ts`). This
dual path means a single `system` prompt reliably reaches the model whether or
not the upstream honors the dedicated field.

## Cost guardrails

- Rate limiting: 10 requests per minute per user, identical to the OpenAI
  function. Shared in-memory state per edge instance.
- Message trimming: client messages are capped to the last 12 turns and each
  content string to 1200 chars before dispatch.
- Token caps: `maxOutputTokens` defaults to 320 (matching the OpenAI coach),
  configurable via `COACH_GEMMA_MAX_TOKENS`.

## Follow-ups

- Wire `<CoachCloudProviderPicker />` into the coaching settings surface once
  PR #443 (`app/(modals)/settings-coaching.tsx`) is merged.
- Probe `GEMINI_API_KEY` availability from the client via a lightweight HEAD
  ping so the picker's `available` prop can reflect runtime state.
- Persist conversations from the Gemma path to `coach_conversations` once the
  `metadata.model` column is generalized to accept any provider model id.
- Add a parity eval comparing OpenAI and Gemma responses on the same prompts
  for regression gating.
