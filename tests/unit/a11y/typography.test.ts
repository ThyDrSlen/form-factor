const mockGetFontScale = jest.fn<number, []>();

jest.mock('react-native', () => ({
  PixelRatio: {
    getFontScale: () => mockGetFontScale(),
  },
}));

import { MAX_FONT_SCALE, MIN_FONT_SIZE, scaled } from '@/lib/a11y/typography';

describe('scaled', () => {
  beforeEach(() => {
    mockGetFontScale.mockReset();
  });

  it('passes through native pixel value when system scale is 1', () => {
    mockGetFontScale.mockReturnValue(1);
    expect(scaled(16)).toBe(16);
  });

  it('clamps system scale to MAX_FONT_SCALE (default 1.3)', () => {
    mockGetFontScale.mockReturnValue(2); // accessibility largest setting
    expect(scaled(14)).toBe(Math.round(14 * MAX_FONT_SCALE));
  });

  it('floors values below MIN_FONT_SIZE (11)', () => {
    mockGetFontScale.mockReturnValue(1);
    expect(scaled(8)).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    expect(scaled(9)).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it('respects custom max override', () => {
    mockGetFontScale.mockReturnValue(2);
    expect(scaled(14, { max: 15 })).toBeLessThanOrEqual(15);
  });

  it('respects custom min override above floor', () => {
    mockGetFontScale.mockReturnValue(1);
    expect(scaled(10, { min: 12 })).toBeGreaterThanOrEqual(12);
  });

  it('is defensive when PixelRatio throws', () => {
    mockGetFontScale.mockImplementation(() => {
      throw new Error('native bridge unavailable');
    });
    expect(scaled(14)).toBe(14);
  });

  it('ignores sub-1 scales (system never shrinks HUD)', () => {
    mockGetFontScale.mockReturnValue(0.5);
    expect(scaled(14)).toBe(14);
  });
});
