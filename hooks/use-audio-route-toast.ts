/**
 * useAudioRouteToast
 *
 * Surfaces audio-route fallbacks as a user-visible toast so that when
 * Bluetooth or wired headphones drop out we don't silently switch to the
 * phone speaker. Attaches to the AudioSessionManager route subscription
 * and calls into the existing ToastContext.
 */

import { useEffect } from 'react';
import { audioSessionManager } from '@/lib/services/audio-session-manager';
import { useToast } from '@/contexts/ToastContext';

export function useAudioRouteToast(): void {
  const { show } = useToast();

  useEffect(() => {
    return audioSessionManager.subscribeRouteChanges((event) => {
      if (event.fellBackToSpeaker) {
        show('Switched to iPhone speaker', { type: 'info' });
      }
    });
  }, [show]);
}

export default useAudioRouteToast;
