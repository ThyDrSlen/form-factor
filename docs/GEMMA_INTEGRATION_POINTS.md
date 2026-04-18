# Gemma Integration Points

Status: recommendation (2026-04-17). Companion to `docs/GEMMA_RUNTIME_DECISION.md`.

Each Gemma-adjacent service is scaffolded with a pluggable runner and a
deterministic fallback. This doc maps each one to the specific live
surface where the integration should land, with a minimal hook sketch
and a priority ranking.

## Summary table

| Service | Live surface | Minimal hook | Priority | Risk |
|---|---|---|---|---|
| `fault-explainer` | `FaultSynthesisChip` over detected fault stack | Already scaffolded; no consumer today | 2 | Low |
| `personalized-cue` | `FaultGlossaryChip` tap → detail modal | One modal + hook already exist in isolation | 3 | Low |
| `watch-signal-translator` | `app/(tabs)/scan-arkit.tsx` cue pipeline | Wrap `speakCue(primaryCue)` with an optional translator pass | 1 | Medium |
| `voice-rpe-parser` | Post-set RPE entry (doesn't currently exist) | Needs a new UI surface first | 4 | Medium |
| `fault-explainer-cactus` | Replaces `fault-explainer-edge` when native bindings land | Swap in `setFaultExplainerRunner(createCactusFaultExplainer())` at bootstrap | 5 | High (native work) |

## Priority 1 — Watch signal translator in the live cue pipeline

**File:** `app/(tabs)/scan-arkit.tsx` around line 1740.

**Today:** `primaryCue` is the stabilized-by-hysteresis message from the
cue engine. It goes directly to `speakCue()` / TTS.

```ts
// Current
speakCue(primaryCue);
```

**Proposed hook:** a middle step that gives the translator a chance to
replace the message with a more contextual version when watch signals
warrant it.

```ts
// Sketch
const signals = deriveWatchSignals(heartRate, cadence, phase, lastRepEccentricSec);
const translated = await getWatchSignalTranslator().translate(signals);
const spoken = translated.tone === 'urgent'
  ? `${translated.cue} ${primaryCue}`  // prepend urgency
  : primaryCue;                         // cue engine keeps the floor
speakCue(spoken);
```

**Why this first:** the cue pipeline is the only consumer-visible speech
surface in the app today. Replacing or augmenting its text delivers user
value on the next ARKit session. The current static rules handle the
obvious cases; Gemma replaces them when exertion context deserves more
nuance.

**Biggest risk:** the hysteresis controller expects stable strings. Any
translator that rewrites the same base message to different text will
flap. Either (a) cache by `(base, signals-bucket)` so repeat calls return
identical strings, or (b) apply the translator *after* hysteresis so it
only fires when a new cue clears the gate.

## Priority 2 — Fault synthesis chip over live detected faults

**File:** wherever faults are currently surfaced to the user during or
after a session. `FaultGlossaryChip` and `FaultSynthesisChip` are both
built and tested but currently mount only in `/labs/fault-synthesis`.

**Blocker:** no live screen currently renders the detected-fault array.
Wave-20 shipped the chip component but not its consumer. Someone has to
decide *where* the user sees fault chips: post-set summary? Live
overlay? Session-history drill-down?

**Hook shape once that decision lands:**

```tsx
<FaultSynthesisChip
  exerciseId={currentExercise.id}
  faultIds={faultsForCurrentSet}
  setContext={{ repNumber, setNumber, rpe }}
  recentHistory={historyFromPastNSessions}
/>
<ScrollView horizontal>
  {faultsForCurrentSet.map((faultId) => (
    <FaultGlossaryChip key={faultId} exerciseId={currentExercise.id} faultId={faultId} />
  ))}
</ScrollView>
```

**Why priority 2 (not 1):** UX decision is upstream. The chip is ready.

## Priority 3 — Personalized cue on fault chip tap

**File:** whatever detail view opens when a user taps a `FaultGlossaryChip`.

**Hook shape:** inside the detail view (currently a stub), render:

```tsx
const { output, status } = usePersonalizedCue({
  exerciseId,
  faultId,
  userHistory: await getUserFaultHistory(userId, faultId),
});
return status === 'ready' ? <Text>{output.cue}</Text> : <Skeleton />;
```

**Why priority 3:** depends on priority 2 landing first (there's no
detail view to push into until a chip is mounted). Static cues are
already decent (see `docs/evals/personalized-cue-report.md`); Gemma
rewrites them when it lands.

## Priority 4 — Voice RPE capture

**File:** doesn't exist yet.

**Blocker:** the parser works (`docs/evals/voice-rpe-report.md` covers
23 utterances) but there's no UI to capture the voice input. Someone has
to decide:

1. Post-set modal with a mic button? (Easiest)
2. Always-listening during rest timer? (Most friction-free, biggest
   permission/battery ask)
3. AirPods-triggered via a long-press? (Best UX, requires
   `react-native-airpods` or similar)

Until that decision lands, the parser is dormant.

**Gemma enhancement once UI exists:** today the parser is pure regex. A
Gemma runner would handle utterances like "maybe a seven but the last
two reps felt off" that the regex misses.

## Priority 5 — Cactus on-device runtime

**File:** `lib/services/fault-explainer-bootstrap.ts` (and future
bootstraps for each service).

**Today:** the bootstrap installs
`createCachingFaultExplainer(createEdgeFaultExplainer())`.

**Swap when native bindings land:**

```ts
const runner = (await isCactusAvailable())
  ? createCachingFaultExplainer(createCactusFaultExplainer({ modelPath: '...' }))
  : createCachingFaultExplainer(createEdgeFaultExplainer());
setFaultExplainerRunner(runner);
```

**Why last:** the decision doc explicitly gates Cactus on Phase 0
usage data. Until the Edge Function is deployed and validated, the
~1GB model download cost isn't justified.

## Cross-cutting: rule-message rotation (no Gemma needed)

While working through the cue-engine code I noticed each `CueRule` has a
single `message: string`. Users hearing the same "brace your core" across
5 sessions is low-retention. A rotation between 2–3 authored variants per
rule — no LLM — is a cheap retention win orthogonal to the Gemma effort.
Flagged here because it's the kind of thing that would otherwise get
deferred as "Gemma will fix it."

## Deploy-gap reminder

Before any of the above lands with a real Gemma path:

```
supabase functions deploy fault-synthesis
supabase secrets set GEMINI_API_KEY=...
```

That flips Priority 2's chip from static-fallback copy to live model
output. Everything else follows.
