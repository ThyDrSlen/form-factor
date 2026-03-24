# Voice Coaching System

## Overview

Two voice features powered by a custom ElevenLabs voice:

1. **Premium Form Cues (Feature B)** — Pre-recorded MP3s replace system TTS during form tracking. < 50ms playback latency with fallback chain.
2. **Coach Voice Mode (Feature A)** — Bidirectional voice conversation on the Coach tab. User speaks via on-device STT, coach responds with streaming ElevenLabs TTS.

## Architecture

### Feature B: Premium Form Tracking Cues

```
primaryCue (from CueHysteresisController)
  → usePremiumCueAudio hook
    → CueAudioMap lookup (cue-manifest.json)
      → MP3 found: expo-av Sound playback (< 50ms)
      → MP3 missing: ElevenLabs Flash API → expo-av
      → Offline: expo-speech fallback (system voice)
```

### Feature A: Coach Voice Mode

```
Mic button press
  → useSpeechToText (expo-speech-recognition, on-device STT)
    → transcript displayed in real-time
  → Stop → transcript sent via handleCoachSend
    → Supabase Edge Function → OpenAI gpt-5.4-mini → response text
      → useStreamingTts → sentence split → ElevenLabs TTS per sentence
        → expo-av queued gapless playback
  → Text appears in chat simultaneously with voice
```

### Audio Session Manager

Centralized singleton managing iOS audio session configuration:

| Mode | Recording | Silent Mode | Interruption | Use Case |
|------|-----------|-------------|--------------|----------|
| `idle` | No | No | Mix | Default state |
| `tracking` | No | Yes | Mix | ARKit form tracking + cue playback |
| `coaching` | Yes | Yes | Duck | Coach voice mode (STT + TTS) |

**Mutual exclusion**: Speech recognition (coaching mode) and ARKit camera (tracking mode) cannot be active simultaneously.

## Setup

### Required Environment Variables

```bash
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_custom_voice_id
ELEVENLABS_MODEL=eleven_flash_v2_5  # optional, this is the default
```

### Generating Cue Audio

Pre-record all form cue MP3s with your custom ElevenLabs voice:

```bash
# List all cues without generating (dry run)
bun run generate:cue-audio -- --dry-run

# Generate MP3 files (requires ELEVENLABS_API_KEY)
bun run generate:cue-audio
```

This creates:
- `assets/audio/cues/*.mp3` — One MP3 per unique cue string (~55 files, ~1-2MB total)
- `assets/audio/cues/cue-manifest.json` — Maps cue text to MP3 filename

MP3 files are gitignored (build artifact). The manifest is tracked.

## File Map

| File | Description |
|------|-------------|
| `lib/services/elevenlabs-service.ts` | ElevenLabs API client (single-shot TTS, streaming, file generation) |
| `lib/services/audio-session-manager.ts` | Centralized audio session mode manager (singleton) |
| `hooks/use-premium-cue-audio.ts` | Premium cue playback with MP3 → cloud → system TTS fallback |
| `hooks/use-speech-to-text.ts` | On-device speech recognition via expo-speech-recognition |
| `hooks/use-streaming-tts.ts` | Sentence-chunked streaming TTS via ElevenLabs + expo-av |
| `hooks/use-voice-mode.ts` | Voice mode orchestrator combining STT + TTS + audio session |
| `scripts/generate-cue-audio.ts` | Build script to pre-generate cue MP3s from workout definitions |
| `assets/audio/cues/cue-manifest.json` | Cue text → MP3 filename mapping |

## Voice Identity

Both features share a single custom ElevenLabs voice configured via `ELEVENLABS_VOICE_ID`. This ensures brand consistency — the same voice speaks form cues during workouts and responds in coach conversations.

## Limitations

- **No voice during ARKit tracking** — Speech recognition requires `allowsRecordingIOS: true` which can conflict with ARKit's camera session. Voice commands during form tracking are not supported.
- **No Apple Watch haptics during ARKit** — iOS disables the Taptic engine when the camera is active.
- **No custom wake word** — Voice mode requires explicit mic button press.
- **No voice on home tab** — Voice mode is only available on the dedicated Coach tab.
- **No audio recording persistence** — User speech is transcribed on-device and discarded. No audio files are stored.
- **Pre-recorded cues are a build artifact** — MP3 files must be regenerated when cue strings change in workout definitions.
