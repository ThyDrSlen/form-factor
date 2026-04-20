# Voice Control Subsystem (#469)

## Overview

Form Factor's hands-free voice **input** pipeline. Complements the existing
voice **output** (cue audio, premium cue audio, #433/#448). While the user's
hands are on the bar during a set, they can say commands like "next",
"pause", "skip rest", "add weight 5", "rpe 8" — the system recognizes the
intent, routes it to the appropriate session action, and surfaces a small
acknowledgement pill over the scan camera.

## Architecture (ASCII)

```
         ┌────────────────────────────┐
         │ expo-speech-recognition    │  (hooks/use-speech-to-text.ts)
         │   raw transcript events    │
         └─────────────┬──────────────┘
                       │ raw text
                       ▼
         ┌────────────────────────────┐
         │ voice-session-manager      │  FSM + wake-word gate
         │   idle/listening/processing│  ("hey form" | "hey coach" | "coach")
         │   speaking/disabled        │
         └─────────────┬──────────────┘
                       │ stripped text (only when wake word matched
                       │ AND state==listening)
                       ▼
         ┌────────────────────────────┐
         │ voice-intent-classifier    │  regex + Levenshtein
         │   ClassifiedIntent         │  confidence >= 0.70
         └─────────────┬──────────────┘
                       │ typed intent (never raw text beyond this point)
                       ▼
         ┌────────────────────────────┐
         │ voice-command-executor     │  routes by intent
         │   ExecutableRunner adapter │
         └─────┬──────────────────────┘
               │
     ┌─────────┼──────────────┬──────────────┬─────────────────┐
     │         │              │              │                 │
     ▼         ▼              ▼              ▼                 ▼
   next      pause       skip_rest      add_weight         log_rpe
   │         resume                     (lb→kg
   ▼         ▼                            conversion)
 session-runner.voice                session-runner.updateSet
  advance/pause/resume                  (actual_weight / perceived_rpe)


         ┌────────────────────────────┐
         │ voice-audio-gate           │  observes audio-session-manager
         │   (#433's source not edited)│
         └─────────────┬──────────────┘
                       │ onCuePlaybackStart/End
                       ▼
         voice-session-manager     ← duplex gating
                                     (drops transcripts while 'speaking')

         ┌────────────────────────────┐
         │ useVoiceControlStore       │  Zustand + AsyncStorage
         │   enabled (persisted)      │  — Does NOT edit app/_layout.tsx
         │   wakeWordMode (persisted) │
         │   voiceSessionPaused       │
         └────────────────────────────┘

         ┌────────────────────────────┐
         │ VoiceCommandFeedback       │  overlay pill
         │   — mounted in scan-arkit  │  (one-line additive)
         └────────────────────────────┘
```

## Wake-word rules

The wake-word gate lives in `voice-session-manager.checkWakeWord()`. A
transcript must start with one of:

- `"hey form"` — the canonical wake phrase
- `"hey coach"`
- `"coach"` (bare)

Rules:

- Case-insensitive.
- The wake phrase must be followed by whitespace, end-of-string, or a comma.
  - `"coaches"` does **not** match (word boundary check).
- Whitespace inside the wake phrase is flexible: `"hey    form next"` works.
- Without a wake word, even a perfect command phrase is dropped as noise.
- The intent classifier also strips wake words defensively, so a caller
  that forgets the gate still doesn't poison classification.

## Intent catalog

| Intent        | Example utterances                                                  | Notes |
|---------------|---------------------------------------------------------------------|-------|
| `next`        | "next", "skip", "move on", "next exercise", "next set"              | Routes to `advanceToNextExercise` |
| `pause`       | "pause", "hold", "wait", "pause workout"                            | Emits `voice.session_paused` |
| `resume`      | "resume", "continue", "go", "let's go", "keep going"                | Emits `voice.session_resumed` |
| `skip_rest`   | "skip rest", "done resting", "end rest", "no rest"                  | Calls `runner.skipRest()` |
| `add_weight`  | "add weight 10", "plus 5 kg", "add 10 pounds", "increase weight 5"  | Converts lb → kg; adds to `actual_weight` |
| `log_rpe`     | "log rpe 8", "rpe 9", "rate 7"                                      | Writes `perceived_rpe` (1-10) |
| `restart`     | "restart", "redo", "start over"                                     | **Deferred** — returns `unsupported` pending #442 |
| `none`        | (everything else, or confidence < 0.70)                              | No-op with "didn't catch that" feedback |

Confidence scores:

- 1.00 — exact phrase match against the table.
- 0.85 — substring match (e.g. "keep going" inside "keep going for me").
- 0.75 — fuzzy (Levenshtein) match within tolerance.
- 0.96 / 0.92 / 0.90 / 0.85 — specific regex hits for `add_weight`.
- 0.95 / 0.90 / 0.78 — specific regex hits for `log_rpe`.
- `CONFIDENCE_THRESHOLD` = 0.70. Below threshold → intent `none`.

## Privacy contract

Defined in `lib/services/voice-privacy-policy.ts`:

```ts
VOICE_PRIVACY_CONTRACT = {
  persistTranscripts: false,
  persistRecognitionAudio: false,
  userConsentRequired: true,
} // frozen, literal-typed
```

Enforcement:

- **Transcripts never leave the classifier.** Downstream code operates on
  `ClassifiedIntent` (a typed enum + numeric params). Raw text is NOT
  written to SQLite, Supabase, Sentry, or logs.
- **Audio samples are never persisted.** `expo-speech-recognition` runs
  inline recognition; we do not request or store raw audio.
- **User must opt in explicitly.** `useVoiceControlStore.enabled` defaults
  to `false`. The mic is not activated until the user flips the toggle.
- The literal `false` types in `VoicePrivacyContract` make any regression
  visible at `tsc` build time — flipping a flag to `true` would break
  every call site.

## Duplex gating rules

Goal: the coach's voice output must not be fed back into the voice input
as a false command ("keep your back straight" → "straight" → noise).

Rules:

- `voice-audio-gate` subscribes to `audioSessionManager.onModeChange`.
- When the audio mode transitions **into** `tracking` (cue playback
  active), the gate calls `voiceSessionManager.onCuePlaybackStart()`.
- When the audio mode transitions **out of** `tracking`, the gate calls
  `voiceSessionManager.onCuePlaybackEnd()`.
- In state `speaking`, `ingestTranscript()` returns `null` unconditionally.
- When cue playback ends, the manager returns to `listening` (if the
  user had previously called `start()`) or `idle`.

**Fallback polling:** if a future revision of `audio-session-manager`
removes the `onModeChange` emitter, the gate polls `getMode()` every 250ms.
The production audio manager does have `onModeChange`, so polling is a
defensive safety net only.

## Feature-flag activation

```ts
import { useVoiceControlStore } from '@/lib/stores/voice-control-store';

// Read enabled flag anywhere
const enabled = useVoiceControlStore((s) => s.enabled);

// Toggle from a settings UI
useVoiceControlStore.getState().setEnabled(true);
```

Persisted to `AsyncStorage` key `ff.voiceControl`. The ephemeral runtime
flag `voiceSessionPaused` is excluded via `partialize`.

## Judgment calls

1. **Extension file vs. editing session-runner.ts.** We chose an extension
   file (`lib/stores/session-runner.voice.ts`) mirroring #434's pattern.
   Editing the main store would conflict with every other open PR that
   touches it. Cost: `emitVoiceEvent()` duplicates the shape of
   session-runner's internal `emitEvent()` because the latter is not
   exported; we bypass it to emit string-literal event types.
2. **String-literal event types instead of extending `SessionEventType`.**
   The enum lives in `lib/types/workout-session.ts` and #442 owns
   refactors there. We emit `'voice.exercise_advanced'`,
   `'voice.session_paused'`, `'voice.session_resumed'` as raw strings.
   When #442 lands, the canonical enum should be extended to include
   these values. Until then the events still persist correctly because
   the SQLite schema for `workout_session_events.type` is `TEXT` with
   no CHECK constraint.
3. **Zustand store instead of React Context.** Adding a new Provider
   would touch `app/_layout.tsx`, which #433 owns. A Zustand store with
   `zustand/middleware` persist achieves the same goal without editing
   the root layout.
4. **Observer wrapper instead of editing audio-session-manager.** #433
   owns the source. Our `voice-audio-gate` subscribes via the existing
   `onModeChange` API without touching the source file.
5. **`restart` intent deferred.** The session runner does not yet expose
   `resetCurrentSet()`. Rather than inventing an API #442 will introduce,
   we return `{ success: false, reason: 'unsupported' }` and show "Not
   supported yet" in the feedback UI.
6. **"go" routes to `resume`.** It's a two-character word and flirts with
   false positives, but within our model the **wake-word gate is the only
   safeguard against random speech** — the classifier assumes it's seeing
   post-gate text. `"go"` after `"hey form"` is unambiguously a resume
   command, so we accept it as an exact synonym.

## Cross-PR TODO

- [ ] **#442 — SessionEventType enum extension.** Once #442 lands on main,
      update `lib/types/workout-session.ts` to include
      `'voice.exercise_advanced' | 'voice.session_paused' |
      'voice.session_resumed'` in the union. Then update
      `lib/stores/session-runner.voice.ts` to use the typed helper.
- [ ] **#442 — resetCurrentSet action.** Once #442 exposes
      `runner.resetCurrentSet()`, implement the `restart` intent in
      `voice-command-executor.ts` (the case block currently returns
      `{ reason: 'unsupported' }`).
- [ ] **#433 — audio-session-manager edits.** If #433 changes the semantic
      meaning of `AudioSessionMode` (e.g. splits `tracking` into
      `tracking-idle` vs `tracking-cue`), update the transition mapping
      in `voice-audio-gate.ts` accordingly. Current mapping: any entry
      into `tracking` → cue start; any exit from `tracking` → cue end.
- [ ] **#434 — pause.ts interaction.** `voicePauseSession` emits an event
      but does NOT flip `isWorkoutInProgress`. When #434's pause.ts lands,
      consider whether voice pause should also set that flag (likely yes,
      via a shared action). For now the two mechanisms are independent.
- [ ] **#443 — coaching settings modal.** Once #443 adds a coach settings
      modal, expose the voice-control toggle there (currently only
      accessible programmatically via the store).

## File index

| Path | Purpose |
|------|---------|
| `lib/services/voice-intent-classifier.ts`    | Pure-TS intent classification (regex + Levenshtein) |
| `lib/services/voice-command-executor.ts`     | Typed-intent → session action router |
| `lib/services/voice-session-manager.ts`      | FSM + wake-word gate |
| `lib/services/voice-audio-gate.ts`           | Duplex observer over audio-session-manager |
| `lib/services/voice-privacy-policy.ts`       | Frozen privacy contract |
| `lib/stores/session-runner.voice.ts`         | advance/pause/resume extension |
| `lib/stores/voice-control-store.ts`          | Zustand store (persisted) |
| `hooks/useVoiceCommandFeedback.ts`           | Display-state hook |
| `components/form-tracking/VoiceCommandFeedback.tsx` | Overlay pill |
| `app/(tabs)/scan-arkit.tsx`                  | 2-line additive mount (import + tag) |
