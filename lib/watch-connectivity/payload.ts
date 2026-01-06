export function sanitizeForNative(value: unknown): any {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    return value.map(sanitizeForNative).filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, any>)) {
      const next = sanitizeForNative(entryValue);
      if (next !== undefined) {
        out[key] = next;
      }
    }
    return out;
  }

  return value;
}
