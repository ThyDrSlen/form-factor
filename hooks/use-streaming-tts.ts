import { useCallback, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { generateSpeech } from '@/lib/services/elevenlabs-service';

interface StreamingTtsControls {
  /** Split `text` into sentences, synthesize each via ElevenLabs, play sequentially. */
  speak: (text: string) => void;
  /** Accumulate streaming chunks; flush complete sentences to the playback queue. */
  speakStream: (chunk: string) => void;
  /** Cancel pending queue and stop current playback immediately. */
  stop: () => void;
  /** `true` while any sentence is being synthesized or played. */
  isSpeaking: boolean;
}

/** Split on sentence-ending punctuation (.?!) followed by whitespace or end. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Hermes-safe ArrayBuffer→base64 (no Buffer/Node dependency). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function speakWithSystemTts(text: string, onDone: () => void): void {
  Speech.speak(text, {
    language: 'en-US',
    rate: 0.55,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

export function useStreamingTts(): StreamingTtsControls {
  const [isSpeaking, setIsSpeaking] = useState(false);

  const queueRef = useRef<string[]>([]);
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const cancelledRef = useRef(false);
  const processingRef = useRef(false);
  const streamBufferRef = useRef('');

  const processQueue = useCallback(async () => {
    // Re-entrancy guard: only one sentence synthesizes/plays at a time
    if (processingRef.current || cancelledRef.current) return;

    const next = queueRef.current.shift();
    if (!next) {
      setIsSpeaking(false);
      return;
    }

    processingRef.current = true;
    setIsSpeaking(true);

    try {
      const audioBuffer = await generateSpeech(next);

      if (cancelledRef.current) {
        processingRef.current = false;
        return;
      }

      if (!audioBuffer) {
        speakWithSystemTts(next, () => {
          processingRef.current = false;
          processQueue();
        });
        return;
      }

      const base64 = arrayBufferToBase64(audioBuffer);
      const uri = `data:audio/mpeg;base64,${base64}`;

      const { sound } = await Audio.Sound.createAsync({ uri });
      currentSoundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          currentSoundRef.current = null;
          processingRef.current = false;
          processQueue();
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.warn('[StreamingTTS] ElevenLabs playback error, falling back to system TTS');
      if (currentSoundRef.current) {
        currentSoundRef.current.unloadAsync().catch(() => {});
        currentSoundRef.current = null;
      }
      speakWithSystemTts(next, () => {
        processingRef.current = false;
        processQueue();
      });
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      cancelledRef.current = false;
      processingRef.current = false;
      streamBufferRef.current = '';

      const sentences = splitSentences(text);
      queueRef.current = sentences;
      processQueue();
    },
    [processQueue],
  );

  const speakStream = useCallback(
    (chunk: string) => {
      cancelledRef.current = false;
      streamBufferRef.current += chunk;

      const sentences = splitSentences(streamBufferRef.current);

      if (sentences.length > 1) {
        // All but last are complete; last may still be accumulating
        const complete = sentences.slice(0, -1);
        streamBufferRef.current = sentences[sentences.length - 1];
        queueRef.current.push(...complete);

        if (!processingRef.current) {
          processQueue();
        }
      }
    },
    [processQueue],
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    processingRef.current = false;
    queueRef.current = [];
    streamBufferRef.current = '';

    Speech.stop();

    if (currentSoundRef.current) {
      currentSoundRef.current.stopAsync().catch(() => {});
      currentSoundRef.current.unloadAsync().catch(() => {});
      currentSoundRef.current = null;
    }

    setIsSpeaking(false);
  }, []);

  return { speak, speakStream, stop, isSpeaking };
}
