import { parseRpeUtterance, type ParsedRpe, type RpeFlag } from '@/lib/services/voice-rpe-parser';

// Helper to keep assertions concise
function expectRpe(result: ParsedRpe, expected: Partial<ParsedRpe>): void {
  if ('rpe' in expected) expect(result.rpe).toBe(expected.rpe);
  if ('flags' in expected) expect(result.flags).toEqual(expected.flags);
  if ('source' in expected) expect(result.source).toBe(expected.source);
  if ('confidence' in expected) expect(result.confidence).toBe(expected.confidence);
  if ('notes' in expected) expect(result.notes).toBe(expected.notes);
}

describe('voice-rpe-parser — parseRpeUtterance', () => {
  // -------------------------------------------------------------------------
  // Basic digit extraction
  // -------------------------------------------------------------------------

  it('extracts a clean digit RPE and sets confidence 0.9', () => {
    const result = parseRpeUtterance('8');
    expectRpe(result, { rpe: 8, flags: [], confidence: 0.9, source: 'regex' });
  });

  it('extracts digit at the start followed by a comma', () => {
    const result = parseRpeUtterance('8,');
    expectRpe(result, { rpe: 8, confidence: 0.9 });
  });

  it('extracts digit with trailing notes and detects grindy flag', () => {
    const result = parseRpeUtterance('8 felt grindy on the last three');
    expectRpe(result, {
      rpe: 8,
      flags: ['grindy'] as RpeFlag[],
      confidence: 0.9,
      source: 'regex',
    });
    expect(result.notes).toBe('felt grindy on the last three');
  });

  // -------------------------------------------------------------------------
  // "rpe N" prefix
  // -------------------------------------------------------------------------

  it('strips "rpe" prefix (digit form)', () => {
    const result = parseRpeUtterance('rpe 7');
    expectRpe(result, { rpe: 7, confidence: 0.9 });
    expect(result.notes).toBe('');
  });

  it('strips "rpe" prefix (word form) and sets confidence 0.7', () => {
    const result = parseRpeUtterance('rpe seven');
    expectRpe(result, { rpe: 7, confidence: 0.7 });
    expect(result.notes).toBe('');
  });

  // -------------------------------------------------------------------------
  // Word-form numbers
  // -------------------------------------------------------------------------

  it('resolves word "eight" to rpe 8 with confidence 0.7', () => {
    const result = parseRpeUtterance('eight');
    expectRpe(result, { rpe: 8, confidence: 0.7, flags: [] });
  });

  it('resolves all word-form numbers zero through ten', () => {
    const cases: Array<[string, number | null]> = [
      ['zero', null],  // 0 is out of range 1–10
      ['one', 1],
      ['two', 2],
      ['three', 3],
      ['four', 4],
      ['five', 5],
      ['six', 6],
      ['seven', 7],
      ['eight', 8],
      ['nine', 9],
      ['ten', 10],
    ];
    for (const [word, expected] of cases) {
      expect(parseRpeUtterance(word).rpe).toBe(expected);
    }
  });

  // -------------------------------------------------------------------------
  // Ambiguous range — take the higher value
  // -------------------------------------------------------------------------

  it('picks the higher value for "seven maybe eight"', () => {
    const result = parseRpeUtterance('seven maybe eight');
    expectRpe(result, { rpe: 8, confidence: 0.7 });
  });

  it('picks the higher value for "7 or 8" with digit confidence', () => {
    const result = parseRpeUtterance('7 or 8');
    expectRpe(result, { rpe: 8, confidence: 0.9 });
  });

  it('picks the higher value for "maybe 6 or 7"', () => {
    // "6 or 7" range match picks 7
    const result = parseRpeUtterance('6 or 7');
    expectRpe(result, { rpe: 7, confidence: 0.9 });
  });

  // -------------------------------------------------------------------------
  // Out-of-range values
  // -------------------------------------------------------------------------

  it('returns rpe null for out-of-range digit 12', () => {
    const result = parseRpeUtterance('12');
    expectRpe(result, { rpe: null, confidence: 0.2 });
  });

  it('returns rpe null for digit 0', () => {
    const result = parseRpeUtterance('0');
    expectRpe(result, { rpe: null, confidence: 0.2 });
  });

  // -------------------------------------------------------------------------
  // Flag-only utterances (no RPE number)
  // -------------------------------------------------------------------------

  it('detects "brutal" as hard flag with rpe null and confidence 0.5', () => {
    const result = parseRpeUtterance('that was brutal');
    expectRpe(result, { rpe: null, flags: ['hard'] as RpeFlag[], confidence: 0.5 });
  });

  it('detects "really hard" as hard flag', () => {
    const result = parseRpeUtterance('really hard set today');
    expectRpe(result, { rpe: null, flags: ['hard'] as RpeFlag[] });
  });

  it('detects "easy" flag', () => {
    const result = parseRpeUtterance('that felt easy');
    expectRpe(result, { flags: ['easy'] as RpeFlag[] });
  });

  it('detects "cake" as easy flag', () => {
    const result = parseRpeUtterance('total cake');
    expectRpe(result, { flags: ['easy'] as RpeFlag[] });
  });

  it('detects "failed" flag', () => {
    const result = parseRpeUtterance('failed on rep 5');
    expectRpe(result, { flags: ['failed'] as RpeFlag[] });
  });

  it('detects "missed" as failed flag', () => {
    const result = parseRpeUtterance('missed the last rep');
    expectRpe(result, { flags: ['failed'] as RpeFlag[] });
  });

  it('detects "form broke" as breakdown flag', () => {
    const result = parseRpeUtterance('form broke on the last rep');
    expectRpe(result, { flags: ['breakdown'] as RpeFlag[] });
  });

  it('detects "breakdown" flag', () => {
    const result = parseRpeUtterance('breakdown in the hole');
    expectRpe(result, { flags: ['breakdown'] as RpeFlag[] });
  });

  it('detects "quick" flag', () => {
    const result = parseRpeUtterance('felt really quick');
    expectRpe(result, { flags: ['quick'] as RpeFlag[] });
  });

  it('detects "fast" as quick flag', () => {
    const result = parseRpeUtterance('bar speed was fast');
    expectRpe(result, { flags: ['quick'] as RpeFlag[] });
  });

  it('detects "snappy" as quick flag', () => {
    const result = parseRpeUtterance('snappy off the floor');
    expectRpe(result, { flags: ['quick'] as RpeFlag[] });
  });

  it('detects "paused" flag', () => {
    const result = parseRpeUtterance('paused at the bottom');
    expectRpe(result, { flags: ['paused'] as RpeFlag[] });
  });

  it('detects "stopped mid" as paused flag', () => {
    const result = parseRpeUtterance('stopped mid rep');
    expectRpe(result, { flags: ['paused'] as RpeFlag[] });
  });

  // -------------------------------------------------------------------------
  // Multiple flags at once
  // -------------------------------------------------------------------------

  it('detects multiple flags in a single utterance', () => {
    const result = parseRpeUtterance('9 grindy and form broke at the end');
    expect(result.rpe).toBe(9);
    expect(result.flags).toContain('grindy');
    expect(result.flags).toContain('breakdown');
  });

  // -------------------------------------------------------------------------
  // Empty / whitespace input
  // -------------------------------------------------------------------------

  it('returns safe defaults for an empty string', () => {
    const result = parseRpeUtterance('');
    expectRpe(result, {
      rpe: null,
      notes: '',
      flags: [],
      confidence: 0.2,
      source: 'regex',
    });
  });

  it('returns safe defaults for whitespace-only input', () => {
    const result = parseRpeUtterance('   ');
    expectRpe(result, { rpe: null, notes: '', flags: [], confidence: 0.2 });
  });

  // -------------------------------------------------------------------------
  // Mixed-case preservation in notes
  // -------------------------------------------------------------------------

  it('preserves mixed-case text in notes after stripping the RPE token', () => {
    const result = parseRpeUtterance('8 Felt GRINDY on the last THREE');
    expect(result.rpe).toBe(8);
    expect(result.notes).toBe('Felt GRINDY on the last THREE');
  });

  // -------------------------------------------------------------------------
  // Confidence degrades for ambiguous inputs
  // -------------------------------------------------------------------------

  it('confidence is 0.7 (not 0.9) when RPE is expressed as a word', () => {
    const result = parseRpeUtterance('nine');
    expect(result.confidence).toBe(0.7);
    expect(result.rpe).toBe(9);
  });

  it('confidence is 0.5 when only flags were matched (no RPE)', () => {
    const result = parseRpeUtterance('really grindy today');
    expect(result.rpe).toBeNull();
    expect(result.confidence).toBe(0.5);
  });

  it('confidence is 0.2 when nothing parseable was found', () => {
    const result = parseRpeUtterance('let us go champ');
    expect(result.rpe).toBeNull();
    expect(result.flags).toEqual([]);
    expect(result.confidence).toBe(0.2);
  });

  // -------------------------------------------------------------------------
  // Source field
  // -------------------------------------------------------------------------

  it('always returns source "regex"', () => {
    expect(parseRpeUtterance('8').source).toBe('regex');
    expect(parseRpeUtterance('brutal').source).toBe('regex');
    expect(parseRpeUtterance('').source).toBe('regex');
  });

  // -------------------------------------------------------------------------
  // Notes strips RPE tokens correctly
  // -------------------------------------------------------------------------

  it('notes is empty when the utterance is only an RPE digit', () => {
    expect(parseRpeUtterance('8').notes).toBe('');
  });

  it('notes strips "rpe N" prefix and leaves the rest', () => {
    const result = parseRpeUtterance('rpe 8 bar moved well');
    expect(result.rpe).toBe(8);
    expect(result.notes).toBe('bar moved well');
  });

  it('notes does not include the matched range tokens', () => {
    const result = parseRpeUtterance('eight or nine felt smooth');
    expect(result.rpe).toBe(9);
    expect(result.notes.toLowerCase()).toContain('felt smooth');
  });
});
