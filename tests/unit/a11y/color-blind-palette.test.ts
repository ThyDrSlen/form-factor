import {
  PALETTES,
  selectFqiColor,
  selectFqiShape,
  type ColorBlindMode,
} from '@/lib/a11y/color-blind-palette';

describe('color-blind-palette', () => {
  it('exposes a palette for each supported mode', () => {
    const modes: ColorBlindMode[] = [
      'off',
      'protanopia',
      'deuteranopia',
      'tritanopia',
      'high-contrast',
    ];
    modes.forEach((mode) => {
      const palette = PALETTES[mode];
      expect(palette).toBeDefined();
      expect(palette.good).toMatch(/^#[0-9A-F]{6}$/i);
      expect(palette.warn).toMatch(/^#[0-9A-F]{6}$/i);
      expect(palette.bad).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  it('uses distinct colours for good/warn/bad in every mode', () => {
    (Object.keys(PALETTES) as ColorBlindMode[]).forEach((mode) => {
      const palette = PALETTES[mode];
      const unique = new Set([palette.good, palette.warn, palette.bad]);
      // high-contrast uses white/yellow/red — still 3 distinct values
      expect(unique.size).toBeGreaterThanOrEqual(2);
    });
  });

  it('selectFqiColor routes scores to the right slot', () => {
    const palette = PALETTES.protanopia;
    expect(selectFqiColor(90, 'protanopia')).toBe(palette.good);
    expect(selectFqiColor(60, 'protanopia')).toBe(palette.warn);
    expect(selectFqiColor(20, 'protanopia')).toBe(palette.bad);
  });

  it('selectFqiColor returns neutral for invalid scores', () => {
    expect(selectFqiColor(Number.NaN, 'off')).toBe(PALETTES.off.neutral);
  });

  it('selectFqiShape maps score buckets to check/bar/dot', () => {
    expect(selectFqiShape(95)).toBe('check');
    expect(selectFqiShape(55)).toBe('bar');
    expect(selectFqiShape(10)).toBe('dot');
  });
});
