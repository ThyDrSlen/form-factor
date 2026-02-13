export type Vec3 = { x: number; y: number; z: number };

export type Joint3D = Vec3 & { conf: number };

export type Phase = 'setup' | 'eccentric' | 'bottom' | 'concentric' | 'top';

export interface BodyState {
  t: number;
  joints3D: Record<string, Joint3D>;
  angles: Record<string, number>;
  derived: Record<string, number>;
  phase: Phase;
  confidence: number;
  cues: string[];
}

export interface FrameFeatureRegistry {
  get<T>(key: string, compute: () => T): T;
  set<T>(key: string, value: T): T;
  has(key: string): boolean;
  reset(): void;
}

class InMemoryFrameFeatureRegistry implements FrameFeatureRegistry {
  private readonly cache = new Map<string, unknown>();

  get<T>(key: string, compute: () => T): T {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }

    const value = compute();
    this.cache.set(key, value);
    return value;
  }

  set<T>(key: string, value: T): T {
    this.cache.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  reset(): void {
    this.cache.clear();
  }
}

export function createFrameFeatureRegistry(): FrameFeatureRegistry {
  return new InMemoryFrameFeatureRegistry();
}

export function createInitialBodyState(t: number): BodyState {
  return {
    t,
    joints3D: {},
    angles: {},
    derived: {},
    phase: 'setup',
    confidence: 0,
    cues: [],
  };
}
