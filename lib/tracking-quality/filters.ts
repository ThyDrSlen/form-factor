import type { CanonicalJoint2D, CanonicalJointMap } from '@/lib/pose/types';

import { EMA_ALPHA_ANGLE, EMA_ALPHA_COORD, MAX_PX_PER_FRAME } from './config';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeAlpha(alpha: unknown): number {
  if (!isFiniteNumber(alpha)) {
    return 0;
  }
  return clamp(alpha, 0, 1);
}

function sanitizeMaxDelta(maxDelta: unknown): number {
  if (!isFiniteNumber(maxDelta)) {
    return 0;
  }
  return Math.max(0, maxDelta);
}

function sanitizeJointForOutput(input: {
  previous: CanonicalJoint2D | null;
  incoming: CanonicalJoint2D | null;
  isTracked: boolean;
  x: number;
  y: number;
}): CanonicalJoint2D {
  return {
    x: input.x,
    y: input.y,
    isTracked: input.isTracked,
    confidence:
      typeof input.incoming?.confidence === 'number'
        ? input.incoming.confidence
        : typeof input.previous?.confidence === 'number'
          ? input.previous.confidence
          : undefined,
  };
}

function clampPointDelta(prev: { x: number; y: number }, next: { x: number; y: number }, maxDelta: number): {
  x: number;
  y: number;
} {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;

  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { x: prev.x, y: prev.y };
  }

  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= maxDelta || dist === 0) {
    return { x: next.x, y: next.y };
  }

  const scale = maxDelta / dist;
  return {
    x: prev.x + dx * scale,
    y: prev.y + dy * scale,
  };
}

function ema(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function collectKeys(input: {
  previous?: CanonicalJointMap | null;
  incoming?: CanonicalJointMap | null;
  jointKeys?: Iterable<string> | null;
}): string[] {
  const out = new Set<string>();
  if (input.jointKeys) {
    for (const key of input.jointKeys) {
      out.add(key);
    }
  }
  if (input.previous) {
    for (const key of input.previous.keys()) {
      out.add(key);
    }
  }
  if (input.incoming) {
    for (const key of input.incoming.keys()) {
      out.add(key);
    }
  }
  return Array.from(out);
}

export function clampVelocity(input: {
  previous: CanonicalJointMap | null;
  incoming: CanonicalJointMap;
  maxDelta?: number;
  jointKeys?: Iterable<string> | null;
}): CanonicalJointMap {
  const maxDelta = sanitizeMaxDelta(input.maxDelta ?? MAX_PX_PER_FRAME);
  const keys = collectKeys({ previous: input.previous, incoming: input.incoming, jointKeys: input.jointKeys });

  const out: CanonicalJointMap = new Map();
  for (const key of keys) {
    const prev = input.previous?.get(key) ?? null;
    const next = input.incoming.get(key) ?? null;

    const prevValid = !!prev && isFiniteNumber(prev.x) && isFiniteNumber(prev.y);
    const nextValid = !!next && isFiniteNumber(next.x) && isFiniteNumber(next.y);

    const incomingTracked = !!next && next.isTracked === true && nextValid;
    const effectiveTracked = incomingTracked;

    if (!next || !nextValid) {
      if (prev && prevValid) {
        out.set(
          key,
          sanitizeJointForOutput({
            previous: prev,
            incoming: next,
            isTracked: false,
            x: prev.x,
            y: prev.y,
          }),
        );
      }
      continue;
    }

    if (!prev || !prevValid) {
      out.set(
        key,
        sanitizeJointForOutput({
          previous: prev,
          incoming: next,
          isTracked: effectiveTracked,
          x: next.x,
          y: next.y,
        }),
      );
      continue;
    }

    if (!effectiveTracked) {
      out.set(
        key,
        sanitizeJointForOutput({
          previous: prev,
          incoming: next,
          isTracked: false,
          x: prev.x,
          y: prev.y,
        }),
      );
      continue;
    }

    const limited = clampPointDelta(prev, next, maxDelta);
    out.set(
      key,
      sanitizeJointForOutput({
        previous: prev,
        incoming: next,
        isTracked: true,
        x: limited.x,
        y: limited.y,
      }),
    );
  }

  return out;
}

export function smoothCoordinateEMA(input: {
  previous: CanonicalJointMap | null;
  incoming: CanonicalJointMap;
  alpha?: number;
  jointKeys?: Iterable<string> | null;
}): CanonicalJointMap {
  const alpha = sanitizeAlpha(input.alpha ?? EMA_ALPHA_COORD);
  const keys = collectKeys({ previous: input.previous, incoming: input.incoming, jointKeys: input.jointKeys });

  const out: CanonicalJointMap = new Map();
  for (const key of keys) {
    const prev = input.previous?.get(key) ?? null;
    const next = input.incoming.get(key) ?? null;

    const prevValid = !!prev && isFiniteNumber(prev.x) && isFiniteNumber(prev.y);
    const nextValid = !!next && isFiniteNumber(next.x) && isFiniteNumber(next.y);
    const nextTracked = !!next && next.isTracked === true && nextValid;

    if (!next || !nextValid) {
      if (prev && prevValid) {
        out.set(
          key,
          sanitizeJointForOutput({
            previous: prev,
            incoming: next,
            isTracked: false,
            x: prev.x,
            y: prev.y,
          }),
        );
      }
      continue;
    }

    if (!prev || !prevValid) {
      out.set(
        key,
        sanitizeJointForOutput({
          previous: prev,
          incoming: next,
          isTracked: nextTracked,
          x: next.x,
          y: next.y,
        }),
      );
      continue;
    }

    if (!nextTracked || alpha === 0) {
      out.set(
        key,
        sanitizeJointForOutput({
          previous: prev,
          incoming: next,
          isTracked: nextTracked,
          x: prev.x,
          y: prev.y,
        }),
      );
      continue;
    }

    out.set(
      key,
      sanitizeJointForOutput({
        previous: prev,
        incoming: next,
        isTracked: true,
        x: ema(prev.x, next.x, alpha),
        y: ema(prev.y, next.y, alpha),
      }),
    );
  }

  return out;
}

export function smoothAngleEMA(input: {
  previous: number | null;
  incoming: number | null;
  alpha?: number;
}): number | null {
  const alpha = sanitizeAlpha(input.alpha ?? EMA_ALPHA_ANGLE);
  const prev = input.previous;
  const next = input.incoming;

  const prevValid = isFiniteNumber(prev);
  const nextValid = isFiniteNumber(next);

  if (!nextValid) {
    return prevValid ? prev : null;
  }
  if (!prevValid || alpha === 0) {
    return next;
  }

  return ema(prev, next, alpha);
}

export function filterCoordinates(input: {
  previous: CanonicalJointMap | null;
  incoming: CanonicalJointMap;
  maxDelta?: number;
  alpha?: number;
  jointKeys?: Iterable<string> | null;
}): CanonicalJointMap {
  const clamped = clampVelocity({
    previous: input.previous,
    incoming: input.incoming,
    maxDelta: input.maxDelta,
    jointKeys: input.jointKeys,
  });

  return smoothCoordinateEMA({
    previous: input.previous,
    incoming: clamped,
    alpha: input.alpha,
    jointKeys: input.jointKeys,
  });
}
