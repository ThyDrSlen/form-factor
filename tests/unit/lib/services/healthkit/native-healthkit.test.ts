/**
 * Tests for lib/services/healthkit/native-healthkit.ts
 *
 * getNativeHealthKit():
 * - Returns null on non-iOS platforms
 * - Loads and caches the native module on iOS
 * - Returns null and logs once when requireNativeModule throws
 */

const mockRequireNativeModule = jest.fn();

jest.mock('expo-modules-core', () => ({
  requireNativeModule: mockRequireNativeModule,
}));

jest.mock('@/lib/logger', () => ({
  logWithTs: jest.fn(),
  warnWithTs: jest.fn(),
  errorWithTs: jest.fn(),
}));

// We need to control Platform.OS per test, so we use a mutable ref
let mockPlatformOS = 'ios';
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatformOS; } },
}));

describe('native-healthkit', () => {
  beforeEach(() => {
    jest.resetModules();
    mockRequireNativeModule.mockReset();
    mockPlatformOS = 'ios';
  });

  function loadModule() {
    return require('@/lib/services/healthkit/native-healthkit') as typeof import('@/lib/services/healthkit/native-healthkit');
  }

  it('returns null on non-iOS platforms', () => {
    mockPlatformOS = 'android';
    const { getNativeHealthKit } = loadModule();
    expect(getNativeHealthKit()).toBeNull();
    expect(mockRequireNativeModule).not.toHaveBeenCalled();
  });

  it('returns null on web platform', () => {
    mockPlatformOS = 'web';
    const { getNativeHealthKit } = loadModule();
    expect(getNativeHealthKit()).toBeNull();
  });

  it('loads and returns the native module on iOS', () => {
    const fakeModule = { isAvailable: () => true };
    mockRequireNativeModule.mockReturnValue(fakeModule);

    const { getNativeHealthKit } = loadModule();
    const result = getNativeHealthKit();

    expect(result).toBe(fakeModule);
    expect(mockRequireNativeModule).toHaveBeenCalledWith('FFHealthKit');
  });

  it('caches the module after first successful load', () => {
    const fakeModule = { isAvailable: () => true };
    mockRequireNativeModule.mockReturnValue(fakeModule);

    const { getNativeHealthKit } = loadModule();
    const first = getNativeHealthKit();
    const second = getNativeHealthKit();

    expect(first).toBe(second);
    // requireNativeModule should only be called once due to caching
    expect(mockRequireNativeModule).toHaveBeenCalledTimes(1);
  });

  it('returns null when requireNativeModule throws', () => {
    mockRequireNativeModule.mockImplementation(() => {
      throw new Error('Module not found');
    });

    const { getNativeHealthKit } = loadModule();
    const result = getNativeHealthKit();

    expect(result).toBeNull();
  });

  it('logs error only once on repeated failures', () => {
    const { errorWithTs } = require('@/lib/logger');
    mockRequireNativeModule.mockImplementation(() => {
      throw new Error('Module not found');
    });

    const { getNativeHealthKit } = loadModule();
    getNativeHealthKit();
    getNativeHealthKit();
    getNativeHealthKit();

    // errorWithTs should only be called once due to loggedFailure flag
    expect(errorWithTs).toHaveBeenCalledTimes(1);
    expect(errorWithTs).toHaveBeenCalledWith(
      '[HealthKit] Failed to load FFHealthKit module',
      expect.any(Error)
    );
  });
});
