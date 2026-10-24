import fs from 'fs';
import path from 'path';
import { readBodyFatHistory } from '@/lib/services/healthkit/body-composition';
const mockNative = { isAvailable: jest.fn(() => true), requestAuthorization: jest.fn(), getQuantitySamples: jest.fn() };
jest.mock('@/lib/services/healthkit/native-healthkit', () => ({ getNativeHealthKit: () => mockNative }));

describe('optional body composition', () => {
  beforeEach(() => { jest.clearAllMocks(); mockNative.requestAuthorization.mockResolvedValue({}); });
  it('reads observed fractions as percent without filling days', async () => {
    mockNative.getQuantitySamples.mockResolvedValue([{ value: 0.18, startDate: '2026-10-01T12:00:00Z' }]);
    const rows = await readBodyFatHistory(new Date('2026-10-10T12:00:00Z'));
    expect(rows).toEqual([{ value: 18, date: Date.parse('2026-10-01T12:00:00Z') }]);
    expect(mockNative.requestAuthorization).toHaveBeenCalledWith(['bodyFatPercentage'], []);
    expect(mockNative.getQuantitySamples).toHaveBeenCalledWith('bodyFatPercentage', expect.any(String), expect.any(String), '%', 0, true);
  });
  it('keeps missing history empty instead of inventing measurements', async () => {
    mockNative.getQuantitySamples.mockResolvedValue([]);
    expect(await readBodyFatHistory()).toEqual([]);
  });
  it('rejects invalid, future and out-of-range measurements', async () => {
    mockNative.getQuantitySamples.mockResolvedValue([
      { value: NaN, startDate: '2026-10-01T12:00:00Z' },
      { value: 1.2, startDate: '2026-10-01T12:00:00Z' },
      { value: 0.18, startDate: 'invalid' },
      { value: 0.18, startDate: '2027-10-01T12:00:00Z' },
      { value: 0.18, startDate: '2020-10-01T12:00:00Z' },
    ]);
    expect(await readBodyFatHistory(new Date('2026-10-10T12:00:00Z'))).toEqual([]);
  });
  it('does not query after an authorization error', async () => {
    mockNative.requestAuthorization.mockRejectedValueOnce(new Error('authorization failed'));
    await expect(readBodyFatHistory()).rejects.toThrow('authorization failed');
    expect(mockNative.getQuantitySamples).not.toHaveBeenCalled();
  });
  it('maps the native percent and VO2 units instead of count', () => {
    const swift = fs.readFileSync(path.join(process.cwd(), 'modules/ff-healthkit/ios/FFHealthKitModule.swift'), 'utf8');
    expect(swift).toContain('identifier = .bodyFatPercentage');
    expect(swift).toContain('HKUnit.percent()');
    expect(swift).toContain('HKUnit.literUnit(with: .milli)');
  });
});
