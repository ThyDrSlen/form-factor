const mockSetPosition = jest.fn().mockResolvedValue(undefined);
const mockPlayAsync = jest.fn().mockResolvedValue(undefined);
const mockUnloadAsync = jest.fn().mockResolvedValue(undefined);
const mockSetOnPlaybackStatusUpdate = jest.fn();
let statusUpdater: ((status: { isLoaded: boolean; didJustFinish?: boolean }) => void) | null = null;

const mockCreateAsync = jest.fn().mockImplementation(async () => {
  const sound = {
    setPositionAsync: mockSetPosition,
    playAsync: mockPlayAsync,
    unloadAsync: mockUnloadAsync,
    setOnPlaybackStatusUpdate: (fn: typeof statusUpdater) => {
      statusUpdater = fn;
      mockSetOnPlaybackStatusUpdate(fn);
    },
  };
  return { sound };
});

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: (...args: unknown[]) => mockCreateAsync(...args),
    },
  },
}));

import { AudioPool } from '@/lib/audio/cue-tones';

describe('AudioPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    statusUpdater = null;
  });

  it('warms all registered tones', async () => {
    const pool = new AudioPool();
    await pool.warm();
    // 3 tones → 3 createAsync calls
    expect(mockCreateAsync).toHaveBeenCalledTimes(3);
  });

  it('plays a tone by calling setPosition + playAsync', async () => {
    const pool = new AudioPool();
    await pool.play('rep-success');
    expect(mockSetPosition).toHaveBeenCalledWith(0);
    expect(mockPlayAsync).toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    const pool = new AudioPool();
    pool.setEnabled(false);
    await pool.play('rep-success');
    expect(mockPlayAsync).not.toHaveBeenCalled();
  });

  it('releases pooled sounds on teardown', async () => {
    const pool = new AudioPool();
    await pool.warm();
    await pool.release();
    expect(mockUnloadAsync).toHaveBeenCalledTimes(3);
  });

  it('recycles a busy entry back to free when playback finishes', async () => {
    const pool = new AudioPool();
    await pool.play('rep-success');
    expect(statusUpdater).not.toBeNull();
    // Simulate onPlaybackStatusUpdate firing with didJustFinish
    statusUpdater?.({ isLoaded: true, didJustFinish: true });
    await pool.play('rep-success'); // should reuse same entry, no new createAsync
    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
  });
});
