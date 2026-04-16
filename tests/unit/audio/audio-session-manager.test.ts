jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  },
  InterruptionModeIOS: { MixWithOthers: 1, DuckOthers: 2 },
  InterruptionModeAndroid: { DuckOthers: 2 },
}));

import { audioSessionManager } from '@/lib/services/audio-session-manager';

describe('AudioSessionManager route-change observability', () => {
  it('notifies subscribers when the route changes', () => {
    const events: string[] = [];
    const unsub = audioSessionManager.subscribeRouteChanges((event) => {
      events.push(`${event.previous}→${event.current}${event.fellBackToSpeaker ? '!' : ''}`);
    });

    audioSessionManager.notifyRouteChanged('headphones');
    audioSessionManager.notifyRouteChanged('speaker'); // fell back!
    audioSessionManager.notifyRouteChanged('speaker'); // no-op, same route

    expect(events).toEqual(['unknown→headphones', 'headphones→speaker!']);
    unsub();
  });

  it('marks fellBackToSpeaker when disconnecting from bluetooth', () => {
    audioSessionManager.notifyRouteChanged('bluetooth');
    const events: Array<{ fellBackToSpeaker: boolean }> = [];
    const unsub = audioSessionManager.subscribeRouteChanges((event) => {
      events.push({ fellBackToSpeaker: event.fellBackToSpeaker });
    });
    audioSessionManager.notifyRouteChanged('speaker');
    expect(events).toEqual([{ fellBackToSpeaker: true }]);
    unsub();
  });

  it('exposes current route via getRoute()', () => {
    audioSessionManager.notifyRouteChanged('airplay');
    expect(audioSessionManager.getRoute()).toBe('airplay');
  });
});
