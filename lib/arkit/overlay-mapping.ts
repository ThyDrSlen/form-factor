export type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

export type Point = { x: number; y: number };

export function isPixelBasedDisplayTransform(transform: AffineTransform): boolean {
  const maxAbs = Math.max(
    Math.abs(transform.a),
    Math.abs(transform.b),
    Math.abs(transform.c),
    Math.abs(transform.d),
  );

  // Normalized-space transforms are typically within ~[-2, 2].
  // Pixel-space transforms usually include viewport-sized scalars.
  return maxAbs > 2;
}

export function invertAffineTransform(transform: AffineTransform): AffineTransform {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (Math.abs(det) < Number.EPSILON) {
    throw new Error('Non-invertible transform');
  }

  const invDet = 1 / det;
  const a = transform.d * invDet;
  const b = -transform.b * invDet;
  const c = -transform.c * invDet;
  const d = transform.a * invDet;
  const tx = -(a * transform.tx + c * transform.ty);
  const ty = -(b * transform.tx + d * transform.ty);

  return { a, b, c, d, tx, ty };
}

export function applyAffineTransform(point: Point, transform: AffineTransform): Point {
  return {
    x: point.x * transform.a + point.y * transform.c + transform.tx,
    y: point.x * transform.b + point.y * transform.d + transform.ty,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mapViewNormalizedToImageNormalized(options: {
  viewNormalized: Point;
  viewportSize: { width: number; height: number };
  displayTransform: AffineTransform;
}): Point {
  const viewTransformIsInPixels = isPixelBasedDisplayTransform(options.displayTransform);
  const viewPoint = viewTransformIsInPixels
    ? {
        x: options.viewNormalized.x * options.viewportSize.width,
        y: options.viewNormalized.y * options.viewportSize.height,
      }
    : options.viewNormalized;

  const viewToImageTransform = invertAffineTransform(options.displayTransform);
  const imagePoint = applyAffineTransform(viewPoint, viewToImageTransform);

  return {
    x: clamp01(imagePoint.x),
    y: clamp01(imagePoint.y),
  };
}

