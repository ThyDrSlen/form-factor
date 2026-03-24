import { useCallback, useState } from 'react';
import { useSpeechToText } from '@/hooks/use-speech-to-text';
import { useStreamingTts } from '@/hooks/use-streaming-tts';
import { audioSessionManager } from '@/lib/services/audio-session-manager';

interface VoiceModeControls {
  startVoiceMode: () => Promise<void>;
  stopVoiceMode: () => string;
  playResponse: (text: string) => void;
  cancelAll: () => void;
  isActive: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  transcript: string;
  error: string | null;
}

export function useVoiceMode(): VoiceModeControls {
  const [isActive, setIsActive] = useState(false);
  const stt = useSpeechToText({ language: 'en-US' });
  const tts = useStreamingTts();

  const startVoiceMode = useCallback(async () => {
    await audioSessionManager.setMode('coaching');
    setIsActive(true);
    await stt.startListening();
  }, [stt]);

  const stopVoiceMode = useCallback(() => {
    stt.stopListening();
    const finalTranscript = stt.transcript;
    return finalTranscript;
  }, [stt]);

  const playResponse = useCallback(
    (text: string) => {
      tts.speak(text);
    },
    [tts],
  );

  const cancelAll = useCallback(() => {
    stt.stopListening();
    tts.stop();
    audioSessionManager.setMode('idle');
    setIsActive(false);
  }, [stt, tts]);

  return {
    startVoiceMode,
    stopVoiceMode,
    playResponse,
    cancelAll,
    isActive,
    isListening: stt.isListening,
    isSpeaking: tts.isSpeaking,
    transcript: stt.transcript,
    error: stt.error,
  };
}
