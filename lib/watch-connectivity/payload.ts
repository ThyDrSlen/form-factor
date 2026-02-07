export type NativeSerializable =
  | string
  | number
  | boolean
  | NativeSerializable[]
  | { [key: string]: NativeSerializable };

export function sanitizeForNative(value: unknown): NativeSerializable | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    return value.map(sanitizeForNative).filter((item): item is NativeSerializable => item !== undefined);
  }

  if (typeof value === 'object') {
    const out: Record<string, NativeSerializable> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      const next = sanitizeForNative(entryValue);
      if (next !== undefined) {
        out[key] = next;
      }
    }
    return out;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}
