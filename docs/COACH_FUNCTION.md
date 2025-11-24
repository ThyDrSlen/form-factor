## AI Coach Edge Function

Supabase Edge Function that powers the in-app Coach tab.

### Configure

1) Set secrets (replace with your key/model):
```
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  COACH_MODEL=gpt-4o-mini \
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
- Defaults: model `gpt-4o-mini`, temperature `0.6`, max tokens `320`. Override with env vars.
- Basic CORS headers are included so Expo web/mobile can call it via `supabase.functions.invoke`.
