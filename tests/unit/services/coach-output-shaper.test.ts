// Unit tests for lib/services/coach-output-shaper.ts (issue #465 Item 5).

import {
  shapeFinalResponse,
  shapeStreamChunk,
  createStreamShaper,
} from '@/lib/services/coach-output-shaper';

describe('shapeFinalResponse (synchronous path)', () => {
  it('trims surrounding whitespace (identity placeholder until #448 lands)', () => {
    expect(shapeFinalResponse('  hello world  ')).toBe('hello world');
  });

  it('passes through normal text unchanged', () => {
    expect(shapeFinalResponse('Bench 4x5 at 80%.')).toBe('Bench 4x5 at 80%.');
  });
});

describe('shapeStreamChunk (sentence-boundary buffering)', () => {
  it('holds back text with no sentence boundary', () => {
    const result = shapeStreamChunk('half a sentence', false);
    expect(result.emit).toBe('');
    expect(result.buffered).toBe('half a sentence');
  });

  it('emits up to and including the last sentence boundary', () => {
    const result = shapeStreamChunk('First sentence. Half of next', false);
    expect(result.emit).toBe('First sentence. ');
    expect(result.buffered).toBe('Half of next');
  });

  it('emits multiple complete sentences in one shot', () => {
    const result = shapeStreamChunk('One. Two? Three!', false);
    expect(result.emit).toMatch(/One\. Two\? Three!?/);
    expect(result.buffered.length).toBeLessThanOrEqual('Three!'.length);
  });

  it('combines prevBuffer with the new chunk before scanning', () => {
    const result = shapeStreamChunk(' world. Next', false, 'hello');
    expect(result.emit).toBe('hello world. ');
    expect(result.buffered).toBe('Next');
  });

  it('flushes everything when isLast=true (final chunk semantics)', () => {
    const result = shapeStreamChunk('trailing fragment', true, 'partial-');
    expect(result.emit).toBe('partial-trailing fragment');
    expect(result.buffered).toBe('');
  });

  it('handles consecutive boundaries (no double-emission)', () => {
    const result = shapeStreamChunk('A. B! C? D', false);
    expect(result.emit).toBe('A. B! C? ');
    expect(result.buffered).toBe('D');
  });

  it('does not split mid-decimal (regex requires whitespace after .?!)', () => {
    const result = shapeStreamChunk('Set 3.5x. Next', false);
    expect(result.emit).toBe('Set 3.5x. ');
    expect(result.buffered).toBe('Next');
  });
});

describe('createStreamShaper (stateful wrapper)', () => {
  it('owns the buffer across multiple chunks', () => {
    const shaper = createStreamShaper();

    const a = shaper.process('Half ', false);
    expect(a.emit).toBe('');
    expect(a.buffered).toBe('Half ');
    expect(shaper.getBuffered()).toBe('Half ');

    const b = shaper.process('a sentence. Then ', false);
    expect(b.emit).toBe('Half a sentence. ');
    expect(b.buffered).toBe('Then ');

    const c = shaper.process('more.', false);
    expect(c.emit).toBe('Then more.');
    expect(c.buffered).toBe('');
  });

  it('flushes the trailing buffer on isLast=true', () => {
    const shaper = createStreamShaper();
    shaper.process('pending fragment', false);
    expect(shaper.getBuffered()).toBe('pending fragment');

    const last = shaper.process('', true);
    expect(last.emit).toBe('pending fragment');
    expect(last.buffered).toBe('');
    expect(shaper.getBuffered()).toBe('');
  });

  it('streams a realistic Gemma reply chunk-by-chunk into clean sentences', () => {
    const shaper = createStreamShaper();
    const chunks = [
      'Push',
      ' day plan: ',
      'Bench 4x5. ',
      'Incline DB ',
      '3x8. Tricep ',
      'pushdowns 3x12.',
    ];

    const emitted: string[] = [];
    for (const c of chunks) {
      const r = shaper.process(c, false);
      if (r.emit) emitted.push(r.emit);
    }
    const flush = shaper.process('', true);
    if (flush.emit) emitted.push(flush.emit);

    expect(emitted.join('')).toBe(
      'Push day plan: Bench 4x5. Incline DB 3x8. Tricep pushdowns 3x12.'
    );
  });
});
