const mockMakeDir = jest.fn();
const mockDownload = jest.fn();
const mockGetInfo = jest.fn();
const mockMove = jest.fn();
const mockDelete = jest.fn();
const mockReadDir = jest.fn();
const mockReadString = jest.fn();
const mockDigest = jest.fn();
const mockGetNetworkState = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDir(...args),
  downloadAsync: (...args: unknown[]) => mockDownload(...args),
  getInfoAsync: (...args: unknown[]) => mockGetInfo(...args),
  moveAsync: (...args: unknown[]) => mockMove(...args),
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
  readDirectoryAsync: (...args: unknown[]) => mockReadDir(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadString(...args),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: (...args: unknown[]) => mockDigest(...args),
}));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: (...args: unknown[]) => mockGetNetworkState(...args),
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

import {
  MANIFEST,
  ZERO_SHA256,
  getModelPath,
  getVersionDir,
  isDownloaded,
  isManifestComplete,
  isVerifyingSupported,
  prune,
  startDownload,
} from '@/lib/services/coach-model-manager';

const VALID_MANIFEST = {
  version: 'gemma-3-270m-it-int4@2026-03-01',
  url: 'https://example.com/gemma.pte',
  sha256: 'a'.repeat(64),
  bytes: 12345,
  license: 'Gemma Terms of Use',
};

describe('coach-model-manager / paths', () => {
  it('derives versionDir under documentDirectory/coach-models/', () => {
    const dir = getVersionDir('vX');
    expect(dir).toBe('file:///docs/coach-models/vX/');
  });

  it('derives modelPath as versionDir/model.pte', () => {
    expect(getModelPath('vX')).toBe('file:///docs/coach-models/vX/model.pte');
  });

  it('falls back to MANIFEST.version when no arg', () => {
    expect(getModelPath()).toContain(MANIFEST.version);
  });
});

describe('coach-model-manager / isManifestComplete', () => {
  it('returns false for bundled placeholder manifest', () => {
    // MANIFEST ships with placeholder URL + zero sha256 + 0 bytes.
    expect(isManifestComplete()).toBe(false);
  });

  it('returns true when all fields are filled', () => {
    expect(isManifestComplete(VALID_MANIFEST)).toBe(true);
  });

  it('returns false when sha256 is all zeroes', () => {
    expect(
      isManifestComplete({ ...VALID_MANIFEST, sha256: ZERO_SHA256 })
    ).toBe(false);
  });

  it('returns false when sha256 is wrong length', () => {
    expect(
      isManifestComplete({ ...VALID_MANIFEST, sha256: 'abc' })
    ).toBe(false);
  });

  it('returns false when bytes is 0', () => {
    expect(
      isManifestComplete({ ...VALID_MANIFEST, bytes: 0 })
    ).toBe(false);
  });
});

describe('coach-model-manager / startDownload refusals', () => {
  beforeEach(() => {
    mockMakeDir.mockReset();
    mockDownload.mockReset();
    mockGetInfo.mockReset();
    mockMove.mockReset();
    mockDelete.mockReset();
    mockReadString.mockReset();
    mockDigest.mockReset();
    mockGetNetworkState.mockReset();
  });

  it('refuses when manifest is incomplete (bundled placeholder)', async () => {
    const result = await startDownload();
    expect(result).toEqual({ ok: false, reason: 'manifest_incomplete' });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('refuses on non-WiFi network', async () => {
    mockGetNetworkState.mockResolvedValue({ isConnected: true, type: 'CELLULAR' });
    const result = await startDownload({ manifestOverride: VALID_MANIFEST });
    expect(result).toEqual({ ok: false, reason: 'no_wifi' });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('allows ETHERNET as WiFi-equivalent', async () => {
    mockMakeDir.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue({ status: 200, uri: 'file:///docs/coach-models/x/model.pte' });
    mockDigest.mockResolvedValue('a'.repeat(64));
    mockReadString.mockResolvedValue('base64bytes');
    mockGetInfo.mockResolvedValue({ exists: true, size: 12345 });
    mockGetNetworkState.mockResolvedValue({ isConnected: true, type: 'ETHERNET' });

    const result = await startDownload({ manifestOverride: VALID_MANIFEST });
    expect(result.ok).toBe(true);
  });

  it('proceeds past WiFi gate when allowCellular is set', async () => {
    mockMakeDir.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue({ status: 200 });
    mockDigest.mockResolvedValue('a'.repeat(64));
    mockReadString.mockResolvedValue('b');
    mockGetInfo.mockResolvedValue({ exists: true, size: 12345 });

    const result = await startDownload({
      manifestOverride: VALID_MANIFEST,
      allowCellular: true,
      hashOverride: async () => 'a'.repeat(64),
    });
    expect(result.ok).toBe(true);
  });
});

describe('coach-model-manager / hash mismatch quarantine', () => {
  beforeEach(() => {
    mockMakeDir.mockReset();
    mockDownload.mockReset();
    mockGetInfo.mockReset();
    mockMove.mockReset();
    mockDelete.mockReset();
  });

  it('moves the file to .corrupt and removes it on SHA mismatch', async () => {
    mockMakeDir.mockResolvedValue(undefined);
    mockDownload.mockResolvedValue({ status: 200 });
    mockMove.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);

    const result = await startDownload({
      manifestOverride: VALID_MANIFEST,
      allowCellular: true,
      hashOverride: async () => 'b'.repeat(64), // does not match a*64
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('hash_mismatch');
    expect(mockMove).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    const [moveArg] = mockMove.mock.calls[0] as { from: string; to: string }[];
    expect(moveArg.to.endsWith('.corrupt')).toBe(true);
  });
});

describe('coach-model-manager / isDownloaded', () => {
  beforeEach(() => {
    mockGetInfo.mockReset();
  });

  it('returns true when file exists and is not a directory', async () => {
    mockGetInfo.mockResolvedValue({ exists: true, isDirectory: false });
    expect(await isDownloaded('v1')).toBe(true);
  });

  it('returns false when file does not exist', async () => {
    mockGetInfo.mockResolvedValue({ exists: false });
    expect(await isDownloaded('v1')).toBe(false);
  });

  it('swallows errors and returns false', async () => {
    mockGetInfo.mockRejectedValue(new Error('io'));
    expect(await isDownloaded('v1')).toBe(false);
  });
});

describe('coach-model-manager / prune', () => {
  beforeEach(() => {
    mockReadDir.mockReset();
    mockDelete.mockReset();
  });

  it('deletes every entry except the keepVersion', async () => {
    mockReadDir.mockResolvedValue(['v1', 'v2', 'keep']);
    mockDelete.mockResolvedValue(undefined);
    const removed = await prune('keep');
    expect(removed.sort()).toEqual(['v1', 'v2']);
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it('returns [] when directory is empty', async () => {
    mockReadDir.mockResolvedValue([]);
    const removed = await prune('keep');
    expect(removed).toEqual([]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('swallows readDirectoryAsync failures', async () => {
    mockReadDir.mockRejectedValue(new Error('missing'));
    const removed = await prune('keep');
    expect(removed).toEqual([]);
  });
});

describe('coach-model-manager / isVerifyingSupported', () => {
  it('returns true when Crypto.digestStringAsync is present', () => {
    expect(isVerifyingSupported()).toBe(true);
  });
});
