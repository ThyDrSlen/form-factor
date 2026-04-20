/**
 * Cue Tones
 *
 * Thin `expo-av` wrapper that pre-loads a small pool of short MP3 tones
 * (rep-success, fault-warn, rest-end) and plays them on demand. The pool is
 * cheap to lazy-instantiate and lives for the duration of the session so
 * repeated emissions don't pay per-play decode cost.
 *
 * Works as a non-voice alternative for users who disable voice coaching
 * (Gap 2 in issue #428).
 */

import { Audio, type AVPlaybackSource, type AVPlaybackStatus } from 'expo-av';

export type CueTone = 'rep-success' | 'fault-warn' | 'rest-end';

export const TONE_ASSETS: Record<CueTone, AVPlaybackSource> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'rep-success': require('../../assets/audio/tones/rep-success.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'fault-warn': require('../../assets/audio/tones/fault-warn.mp3'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  'rest-end': require('../../assets/audio/tones/rest-end.mp3'),
};

interface PoolEntry {
  sound: Audio.Sound;
  busy: boolean;
}

export class AudioPool {
  private pools = new Map<CueTone, PoolEntry[]>();
  private readonly maxPerTone: number;
  private enabled = true;

  constructor(maxPerTone = 2) {
    this.maxPerTone = maxPerTone;
  }

  /** Pre-load every registered tone so the first play is instant. */
  async warm(): Promise<void> {
    const tones = Object.keys(TONE_ASSETS) as CueTone[];
    await Promise.all(tones.map((tone) => this.ensureEntry(tone)));
  }

  async play(tone: CueTone): Promise<void> {
    if (!this.enabled) return;
    const entry = await this.ensureEntry(tone);
    if (!entry) return;
    entry.busy = true;
    try {
      await entry.sound.setPositionAsync(0);
      await entry.sound.playAsync();
    } catch {
      /* ignore playback failures — we don't want audio to crash tracking */
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async release(): Promise<void> {
    const entries = Array.from(this.pools.values()).flat();
    this.pools.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.sound.unloadAsync();
        } catch {
          /* ignore */
        }
      }),
    );
  }

  private async ensureEntry(tone: CueTone): Promise<PoolEntry | null> {
    const existing = this.pools.get(tone) ?? [];
    const free = existing.find((entry) => !entry.busy);
    if (free) return free;

    if (existing.length >= this.maxPerTone) {
      // Reuse the least-recently-used entry (index 0).
      return existing[0] ?? null;
    }

    try {
      const { sound } = await Audio.Sound.createAsync(TONE_ASSETS[tone], { shouldPlay: false });
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          const entry = existing.find((e) => e.sound === sound);
          if (entry) entry.busy = false;
        }
      });
      const entry: PoolEntry = { sound, busy: false };
      existing.push(entry);
      this.pools.set(tone, existing);
      return entry;
    } catch {
      return null;
    }
  }
}

/** Module-level singleton so components share a warmed pool. */
export const cueTones = new AudioPool();
