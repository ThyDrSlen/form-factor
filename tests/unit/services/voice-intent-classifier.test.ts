import {
  classifyIntent,
  normalizeTranscript,
  stripWakeWord,
  resolveWeightUnit,
  CONFIDENCE_THRESHOLD,
  type ClassifiedIntent,
} from '@/lib/services/voice-intent-classifier';

// ===========================================================================
// Normalization helpers
// ===========================================================================

describe('normalizeTranscript', () => {
  it('lowercases and trims', () => {
    expect(normalizeTranscript('  Next Exercise  ')).toBe('next exercise');
  });
  it('strips trailing punctuation', () => {
    expect(normalizeTranscript('Pause!')).toBe('pause');
    expect(normalizeTranscript('Next?')).toBe('next');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeTranscript('add   weight    10')).toBe('add weight 10');
  });
});

describe('stripWakeWord', () => {
  it('removes hey form prefix', () => {
    expect(stripWakeWord('hey form next')).toBe('next');
  });
  it('removes hey coach prefix with comma', () => {
    expect(stripWakeWord('Hey coach, pause')).toBe('pause');
  });
  it('removes bare coach prefix', () => {
    expect(stripWakeWord('coach skip rest')).toBe('skip rest');
  });
  it('leaves non-wake-word prefixes intact', () => {
    expect(stripWakeWord('please pause')).toBe('please pause');
  });
});

describe('resolveWeightUnit', () => {
  it('honors explicit unit from params', () => {
    expect(resolveWeightUnit({ weightUnit: 'lb' }, 'metric')).toBe('lb');
    expect(resolveWeightUnit({ weightUnit: 'kg' }, 'imperial')).toBe('kg');
  });
  it('falls back to metric preference when unit missing', () => {
    expect(resolveWeightUnit({}, 'metric')).toBe('kg');
  });
  it('falls back to imperial preference when unit missing', () => {
    expect(resolveWeightUnit({}, 'imperial')).toBe('lb');
  });
});

// ===========================================================================
// NEXT intent
// ===========================================================================

describe('classifyIntent — next', () => {
  const cases: [string, number][] = [
    ['next', 1],
    ['Next', 1],
    ['Next Exercise', 1],
    ['next set', 1],
    ['skip', 1],
    ['move on', 1],
    ['hey form next', 1],
    ['Hey coach, next exercise', 1],
  ];
  it.each(cases)('%p → next with confidence >= %p', (input, minConf) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('next');
    expect(result.confidence).toBeGreaterThanOrEqual(minConf);
  });

  it('fuzzy match tolerates one-letter typo', () => {
    const result = classifyIntent('nexts');
    expect(result.intent).toBe('next');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });
});

// ===========================================================================
// PAUSE intent
// ===========================================================================

describe('classifyIntent — pause', () => {
  const cases: string[] = [
    'pause',
    'Pause',
    'pause session',
    'hold',
    'hold on',
    'wait',
    'Pause workout',
  ];
  it.each(cases)('%p → pause', (input) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('pause');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('fuzzy tolerates "pouse" typo', () => {
    const result = classifyIntent('pouse');
    expect(result.intent).toBe('pause');
  });
});

// ===========================================================================
// RESUME intent
// ===========================================================================

describe('classifyIntent — resume', () => {
  const cases: string[] = ['resume', 'continue', "let's go", 'keep going', 'resume session'];
  it.each(cases)('%p → resume', (input) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('resume');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  // "go" is documented as an exact synonym for resume (see PATTERNS). This
  // keeps the wake-word gate the only guard against "go" false-positives —
  // the session manager will not route an un-wake utterance to resume.
  it('bare "go" maps to resume (exact synonym)', () => {
    const result = classifyIntent('go');
    expect(result.intent).toBe('resume');
  });
});

// ===========================================================================
// SKIP REST intent
// ===========================================================================

describe('classifyIntent — skip_rest', () => {
  const cases: string[] = [
    'skip rest',
    'done resting',
    'end rest',
    'no rest',
    'skip the rest',
    'Skip Rest',
  ];
  it.each(cases)('%p → skip_rest', (input) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('skip_rest');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });
});

// ===========================================================================
// ADD WEIGHT intent (numeric extraction)
// ===========================================================================

describe('classifyIntent — add_weight', () => {
  it('parses "add weight 10"', () => {
    const r = classifyIntent('add weight 10');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(10);
    expect(r.params.weightUnit).toBeUndefined();
  });
  it('parses "add weight 10 kg"', () => {
    const r = classifyIntent('add weight 10 kg');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(10);
    expect(r.params.weightUnit).toBe('kg');
  });
  it('parses "plus 5"', () => {
    const r = classifyIntent('plus 5');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(5);
  });
  it('parses "plus 2.5 kg" with decimal', () => {
    const r = classifyIntent('plus 2.5 kg');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(2.5);
    expect(r.params.weightUnit).toBe('kg');
  });
  it('parses "add 10 pounds" with imperial unit', () => {
    const r = classifyIntent('add 10 pounds');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(10);
    expect(r.params.weightUnit).toBe('lb');
  });
  it('parses "add 45 lbs"', () => {
    const r = classifyIntent('add 45 lbs');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(45);
    expect(r.params.weightUnit).toBe('lb');
  });
  it('parses "add 2 kilograms"', () => {
    const r = classifyIntent('add 2 kilograms');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(2);
    expect(r.params.weightUnit).toBe('kg');
  });
  it('parses "increase weight by 5"', () => {
    const r = classifyIntent('increase weight by 5');
    expect(r.intent).toBe('add_weight');
    expect(r.params.weight).toBe(5);
  });
  it('rejects zero weight', () => {
    const r = classifyIntent('add weight 0');
    expect(r.intent).not.toBe('add_weight');
  });
  it('rejects negative weight', () => {
    const r = classifyIntent('add weight -5');
    expect(r.intent).not.toBe('add_weight');
  });
});

// ===========================================================================
// LOG RPE intent
// ===========================================================================

describe('classifyIntent — log_rpe', () => {
  it('parses "log rpe 8"', () => {
    const r = classifyIntent('log rpe 8');
    expect(r.intent).toBe('log_rpe');
    expect(r.params.rpe).toBe(8);
  });
  it('parses "rpe 9"', () => {
    const r = classifyIntent('rpe 9');
    expect(r.intent).toBe('log_rpe');
    expect(r.params.rpe).toBe(9);
  });
  it('parses "rpe 7.5" with decimal', () => {
    const r = classifyIntent('rpe 7.5');
    expect(r.intent).toBe('log_rpe');
    expect(r.params.rpe).toBe(7.5);
  });
  it('rejects rpe 0', () => {
    const r = classifyIntent('rpe 0');
    expect(r.intent).not.toBe('log_rpe');
  });
  it('rejects rpe 11 (out of scale)', () => {
    const r = classifyIntent('rpe 11');
    expect(r.intent).not.toBe('log_rpe');
  });
});

// ===========================================================================
// RESTART intent
// ===========================================================================

describe('classifyIntent — restart', () => {
  const cases: string[] = ['restart', 'redo', 'start over', 'restart set', 'redo set', 'do over'];
  it.each(cases)('%p → restart', (input) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('restart');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });
});

// ===========================================================================
// NONE intent — empty / unrecognized / low-confidence
// ===========================================================================

describe('classifyIntent — none', () => {
  const cases: string[] = [
    '',
    '   ',
    'lorem ipsum',
    'what time is it',
    'how about the weather today',
    'play some music please',
  ];
  it.each(cases)('%p → none', (input) => {
    const result = classifyIntent(input);
    expect(result.intent).toBe('none');
  });

  it('returns a well-formed object even on empty input', () => {
    const result = classifyIntent('');
    expect(result).toEqual<ClassifiedIntent>({
      intent: 'none',
      params: {},
      confidence: 0,
      normalized: '',
    });
  });
});

// ===========================================================================
// Noise tolerance — wake words + trailing filler
// ===========================================================================

describe('classifyIntent — noise tolerance', () => {
  it('strips wake word and classifies core phrase', () => {
    const r = classifyIntent('hey form pause');
    expect(r.intent).toBe('pause');
  });
  it('classifies phrase with trailing punctuation', () => {
    const r = classifyIntent('Next!');
    expect(r.intent).toBe('next');
  });
  it('handles doubled whitespace', () => {
    const r = classifyIntent('skip    rest');
    expect(r.intent).toBe('skip_rest');
  });
});

// ===========================================================================
// Gap #9 — keyword-matched but with an invalid/malformed number.
//
// Even when the keyword (`add`, `plus`, `increase`, `rpe`) is present, a
// bad numeric token must not produce a NaN payload. This is the class of
// inputs real STT produces when mishearing ("add minus weight", "plus NaN
// thousand"), and the classifier must either surface the correctly-
// classified intent with finite params, or fall back to `none` — never
// emit `NaN`.
// ===========================================================================

describe('classifyIntent — keyword matched, invalid number', () => {
  it('"add minus weight" does not produce a NaN weight payload', () => {
    const r = classifyIntent('add minus weight');
    // Either we fall back to 'none', or we surface something benign. The
    // critical invariant: no NaN sneaks into params.weight.
    if (r.intent === 'add_weight') {
      expect(Number.isFinite(r.params.weight)).toBe(true);
      expect(r.params.weight).toBeGreaterThan(0);
    } else {
      expect(r.params.weight).toBeUndefined();
    }
  });

  it('"add weight abc" rejects non-numeric token and does not classify as add_weight', () => {
    const r = classifyIntent('add weight abc');
    expect(r.intent).not.toBe('add_weight');
    expect(r.params.weight).toBeUndefined();
  });

  it('"rpe banana" rejects non-numeric and does not produce a NaN rpe', () => {
    const r = classifyIntent('rpe banana');
    expect(r.intent).not.toBe('log_rpe');
    expect(r.params.rpe).toBeUndefined();
  });

  it('"plus" with no number falls back cleanly', () => {
    const r = classifyIntent('plus');
    expect(r.intent).not.toBe('add_weight');
    expect(r.params.weight).toBeUndefined();
  });

  it('"add weight -5" rejects negative number without emitting NaN', () => {
    const r = classifyIntent('add weight -5');
    expect(r.intent).not.toBe('add_weight');
    expect(r.params.weight).toBeUndefined();
  });

  it('ensures every `none` classification has no numeric params', () => {
    const inputs = ['rpe', 'plus kg', 'add weight minus ten', 'rpe minus one'];
    for (const input of inputs) {
      const r = classifyIntent(input);
      if (r.intent === 'none') {
        // Params must be empty; no NaN values.
        expect(r.params).toEqual({});
      } else if (r.intent === 'add_weight' || r.intent === 'log_rpe') {
        if (r.params.weight !== undefined) {
          expect(Number.isFinite(r.params.weight)).toBe(true);
        }
        if (r.params.rpe !== undefined) {
          expect(Number.isFinite(r.params.rpe)).toBe(true);
        }
      }
    }
  });
});
