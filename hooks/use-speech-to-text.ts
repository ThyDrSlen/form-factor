import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

interface SpeechToTextOptions {
  language?: string;
  continuous?: boolean;
}

interface SpeechToTextControls {
  startListening: () => Promise<void>;
  stopListening: () => void;
  isListening: boolean;
  transcript: string;
  error: string | null;
}

export function useSpeechToText(
  options?: SpeechToTextOptions
): SpeechToTextControls {
  const language = options?.language ?? 'en-US';
  const continuous = options?.continuous ?? false;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setError(event.error ?? 'Speech recognition error');
    setIsListening(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  const startListening = useCallback(async () => {
    setError(null);
    setTranscript('');

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      setError('Microphone permission denied');
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: language,
      interimResults: true,
      continuous,
    });
    setIsListening(true);
  }, [language, continuous]);

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      if (isListeningRef.current) {
        ExpoSpeechRecognitionModule.stop();
      }
    };
  }, []);

  return { startListening, stopListening, isListening, transcript, error };
}
