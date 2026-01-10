import {
  applyAffineTransform,
  invertAffineTransform,
  isPixelBasedDisplayTransform,
  mapViewNormalizedToImageNormalized,
} from './overlay-mapping';

describe('overlay-mapping', () => {
  it('detects pixel-based display transforms', () => {
    expect(
      isPixelBasedDisplayTransform({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
    ).toBe(false);

    expect(
      isPixelBasedDisplayTransform({ a: 320, b: 0, c: 0, d: 240, tx: 0, ty: 0 }),
    ).toBe(true);
  });

  it('inverts affine transforms (sanity)', () => {
    const t = { a: 2, b: 0, c: 0, d: 3, tx: 10, ty: -5 };
    const inv = invertAffineTransform(t);

    const p = { x: 4, y: 9 };
    const roundTrip = applyAffineTransform(applyAffineTransform(p, t), inv);
    expect(roundTrip.x).toBeCloseTo(p.x, 8);
    expect(roundTrip.y).toBeCloseTo(p.y, 8);
  });

  it('maps view-normalized to image-normalized for normalized-space transforms', () => {
    const image = mapViewNormalizedToImageNormalized({
      viewNormalized: { x: 0.25, y: 0.75 },
      viewportSize: { width: 200, height: 100 },
      displayTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    });

    expect(image).toEqual({ x: 0.25, y: 0.75 });
  });

  it('maps view-normalized to image-normalized for pixel-space transforms', () => {
    const viewportSize = { width: 200, height: 100 };
    const displayTransform = { a: viewportSize.width, b: 0, c: 0, d: viewportSize.height, tx: 0, ty: 0 };

    const image = mapViewNormalizedToImageNormalized({
      viewNormalized: { x: 0.5, y: 0.25 },
      viewportSize,
      displayTransform,
    });

    expect(image.x).toBeCloseTo(0.5, 8);
    expect(image.y).toBeCloseTo(0.25, 8);
  });

  it('accounts for translation in pixel-space transforms', () => {
    const viewportSize = { width: 200, height: 100 };
    const displayTransform = { a: viewportSize.width, b: 0, c: 0, d: viewportSize.height, tx: 10, ty: 5 };

    const image = mapViewNormalizedToImageNormalized({
      viewNormalized: { x: 0.5, y: 0.5 },
      viewportSize,
      displayTransform,
    });

    expect(image.x).toBeCloseTo((0.5 * viewportSize.width - 10) / viewportSize.width, 8);
    expect(image.y).toBeCloseTo((0.5 * viewportSize.height - 5) / viewportSize.height, 8);
  });
});

