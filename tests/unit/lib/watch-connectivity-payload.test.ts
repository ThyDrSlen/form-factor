import { sanitizeForNative } from '@/lib/watch-connectivity/payload';

describe('sanitizeForNative', () => {
  it('drops undefined keys recursively', () => {
    expect(sanitizeForNative({ a: 1, b: undefined, c: { d: undefined, e: 2 } })).toEqual({
      a: 1,
      c: { e: 2 },
    });
  });

  it('filters undefined array items', () => {
    expect(sanitizeForNative([1, undefined, 2])).toEqual([1, 2]);
  });

  it('drops null keys recursively', () => {
    expect(sanitizeForNative({ a: null, b: 1, c: { d: null, e: 2 } })).toEqual({
      b: 1,
      c: { e: 2 },
    });
  });
});
