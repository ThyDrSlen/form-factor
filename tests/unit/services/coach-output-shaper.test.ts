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

  // ---------------------------------------------------------------------------
  // Wave-29 T3: edge inputs — whitespace-only, emoji-only, unicode.
  //
  // The shaper today is a `trim()` passthrough (see shapeFinalResponse at
  // lib/services/coach-output-shaper.ts:37-41). We capture those contracts
  // explicitly so when PR #448's canonical heuristic lands, the regression
  // surface is obvious.
  // ---------------------------------------------------------------------------
  describe('edge inputs (wave-29 T3)', () => {
    it('collapses whitespace-only input (spaces + newlines) to empty string', () => {
      // Pure whitespace must NOT accidentally be returned as the original
      // string — downstream consumers treat non-empty as "coach said
      // something" and would render a blank bubble.
      expect(shapeFinalResponse('   \n\n   ')).toBe('');
      expect(shapeFinalResponse('\t\n \r\n')).toBe('');
    });

    it('returns an empty string unchanged', () => {
      expect(shapeFinalResponse('')).toBe('');
    });

    it('preserves emoji-only input verbatim', () => {
      // Coaches occasionally respond with a single emoji ("Nailed it! 🎯").
      // The trim path must preserve the emoji bytes without mangling the
      // UTF-16 surrogate pairs.
      const emojis = '\u{1F3AF}\u{1F3AF}\u{1F3AF}';
      expect(shapeFinalResponse(emojis)).toBe(emojis);
    });

    it('preserves emoji surrounded by whitespace after trimming', () => {
      const emojis = '\u{1F4AA}\u{1F4AA}';
      expect(shapeFinalResponse(`   ${emojis}   `)).toBe(emojis);
    });

    it('preserves zero-width joiners and grapheme clusters intact', () => {
      // Family emoji: man + zwj + woman + zwj + girl. The .trim() call
      // operates on code units but cannot split inside the cluster because
      // none of the components are whitespace. Regression guard against
      // any future canonical heuristic that naively strips non-ASCII.
      const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
      expect(shapeFinalResponse(family)).toBe(family);
    });

    it('preserves mixed RTL + LTR unicode text verbatim (minus outer trim)', () => {
      // Mixed-script coach replies (e.g. bilingual users) must not lose
      // directionality markers or combining characters.
      const mixed = '  שלום\u200F world café  ';
      expect(shapeFinalResponse(mixed)).toBe('שלום\u200F world café');
    });

    it('preserves internal newlines after trimming outer whitespace', () => {
      // The LLM often returns multi-line replies; trim must only strip the
      // outer padding and leave the body intact.
      const input = '\n\nLine one.\nLine two.\n\n';
      expect(shapeFinalResponse(input)).toBe('Line one.\nLine two.');
    });
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
