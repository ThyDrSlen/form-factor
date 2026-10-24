# AI providers

Coach features never call a model vendor directly. They call `sendCoachPrompt` (or, for new non-coach work, `generate`/`stream` from `lib/ai/router.ts`), and the model layer picks a provider.

## Pieces

| File | Role |
|------|------|
| `lib/ai/types.ts` | `ModelProvider`: `id`, `kind` (`cloud` / `on-device`), `capabilities` (`stream`, `vision`, `json`), `isAvailable()`, `generate()`, optional `stream()` |
| `lib/ai/registry.ts` | Process-wide provider registry |
| `lib/ai/router.ts` | Picks candidates (preferred ids, then enabled order, filtered by capability and availability), falls back on retryable or spend-cap errors, adapts non-streaming providers to one chunk |
| `lib/ai/config.ts` | `EXPO_PUBLIC_AI_PROVIDERS`, the user's preferred provider, the on-device routing preference |
| `lib/ai/providers/edge-chat-provider.ts` | Transport for Supabase edge functions speaking `{ messages, context, model? }` → `{ message, model? }` |
| `lib/ai/providers/index.ts` | Built-in providers: `openai` (`coach` function) and `gemma-cloud` (`coach-gemma` function, weekly spend cap) |
| `lib/ai/providers/on-device-provider.ts` | Slot for an on-device runtime |

`sendCoachPrompt` adds the coach pipeline around the routed call for every provider: memory clause, workout context, pipeline-v2 safety and shaping, provider/model annotation, conversation persistence and usage tracking.

## Choosing providers

`EXPO_PUBLIC_AI_PROVIDERS` lists the providers allowed to serve, in fallback order. Unset means `openai` only.

```bash
EXPO_PUBLIC_AI_PROVIDERS=openai              # shipped default
EXPO_PUBLIC_AI_PROVIDERS=gemma-cloud,openai  # Gemma first, OpenAI fallback
EXPO_PUBLIC_AI_PROVIDERS=on-device,openai    # phone model first once a runtime is registered
```

Per request the order is: caller hint (`opts.provider`) → pipeline-v2 task policy → the user's preferred provider → the enabled order. A provider that isn't enabled is never tried. A spend-cap rejection always falls back; other retryable failures fall back only with `allowFailover`.

Settings → Coaching → Routing preference applies on top: `cloud_only` drops on-device providers, `prefer_local` tries them first, `local_only` uses nothing else. Never choosing leaves the enabled order alone.

## Adding a cloud model

If the backend can sit behind an edge function that speaks the coach wire format, add an `EdgeChatConfig` (id, function name, error prefix, display name, API-key marker) next to the built-ins and register it in `ensureBuiltinProviders()`. Then list its id in `EXPO_PUBLIC_AI_PROVIDERS`.

## Adding an on-device model

Nothing is linked yet. A runtime package implements `OnDeviceRuntime` and calls `registerOnDeviceRuntime()` once its native module and weights are ready:

```ts
registerOnDeviceRuntime({
  id: 'on-device',
  label: 'Phone model',
  model: 'gemma-3n-e2b-q4',
  isReady: () => runtime.isLoaded(),
  generate: (messages, { signal }) => runtime.complete(messages, { signal }),
});
```

Candidates: `llama.rn` (any GGUF small model: Gemma 3n, Qwen 3, Llama 3.2, Phi), Apple Foundation Models (iOS 26+, no download), MediaPipe LLM Inference, ExecuTorch. Output passes through the same coach pipeline, including the safety filter, as cloud replies.

## Retired

`EXPO_PUBLIC_COACH_DISPATCH`, `EXPO_PUBLIC_COACH_CLOUD_PROVIDER`, `EXPO_PUBLIC_COACH_LOCAL` and `EXPO_PUBLIC_COACH_LOCAL_COHORT_PCT` are no longer read. The first two were read by computed name (`process.env[NAME]`), which Expo does not inline, so they had no effect in release builds. Per-user cohort rollout of the on-device coach was dropped with the scaffold; roll out by build or OTA through `EXPO_PUBLIC_AI_PROVIDERS`, or add a cohort check to the runtime's `isReady()`.
