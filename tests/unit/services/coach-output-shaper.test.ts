import { shapeCoachResponse } from '@/lib/services/coach-output-shaper';

describe('coach-output-shaper', () => {
  describe('short inputs (no-op path)', () => {
    test('returns empty string for empty input', () => {
      expect(shapeCoachResponse('')).toBe('');
      expect(shapeCoachResponse('   ')).toBe('');
    });

    test('returns empty string for non-string input', () => {
      expect(shapeCoachResponse(undefined as unknown as string)).toBe('');
      expect(shapeCoachResponse(null as unknown as string)).toBe('');
    });

    test('leaves short inputs unchanged except for emoji markers', () => {
      const short = 'Keep your chest up and drive through your heels.';
      expect(shapeCoachResponse(short)).toBe(short);
    });

    test('adds nutrition emoji to short nutrition reply', () => {
      const short = 'Aim for around 1g of protein per pound of body weight.';
      const result = shapeCoachResponse(short);
      expect(result.startsWith('🍽️')).toBe(true);
    });

    test('adds safety emoji when pain is mentioned', () => {
      const short = 'If the pain persists, please see a physician.';
      const result = shapeCoachResponse(short);
      expect(result.startsWith('⚠️')).toBe(true);
    });
  });

  describe('long inputs (shaping path)', () => {
    const longText = (
      'Here is a 4-week plan to push your squat. For week one, do 4x8 @ 65% on day one, ' +
      '3x5 @ 75% on day two, and 5x3 @ 80% on day three. ' +
      'Focus on bracing your core. Keep the tempo controlled on the descent. ' +
      'Drive through your heels out of the hole. Avoid rounding your back. ' +
      'Eat at a calorie surplus with plenty of protein. ' +
      'If you feel sharp pain in the knee, stop and see a physical therapist. ' +
      'Deload every fourth week by dropping load and volume.'
    );

    test('converts multiple set patterns to a bullet list', () => {
      const result = shapeCoachResponse(longText, { emoji: false });
      const bullets = result.match(/^- \d+\s*[x×]\s*\d+/gm);
      expect(bullets?.length).toBeGreaterThanOrEqual(3);
    });

    test('adds intensity/deload/safety markers when long', () => {
      const result = shapeCoachResponse(longText);
      expect(result).toMatch(/⚠️/);
      expect(result).toMatch(/⬇️/);
    });

    test('respects emoji:false and emits no emoji markers', () => {
      const result = shapeCoachResponse(longText, { emoji: false });
      expect(result).not.toMatch(/⚡|⬇️|🍽️|⚠️/);
    });

    test('respects custom maxWords threshold', () => {
      // With very low threshold, even a short string should get shaped.
      const input = 'Do 3x8 @ 165lb, then 3x5 @ 185lb, then 3x3 @ 205lb.';
      const shaped = shapeCoachResponse(input, { maxWords: 5, emoji: false });
      const bullets = shaped.match(/^- \d+\s*[x×]\s*\d+/gm);
      expect(bullets?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('numbered lists for long paragraphs', () => {
    test('collapses 3+ sentence paragraph into numbered list', () => {
      const input = (
        'First, warm up thoroughly for at least ten minutes. ' +
        'Second, perform two warm-up sets at fifty percent of your working weight. ' +
        'Third, take a longer rest between your top working sets. ' +
        'Fourth, finish with an accessory like lunges or split squats to balance the posterior chain. ' +
        'Fifth, hydrate well and refuel with a protein-rich meal within an hour. ' +
        'Sixth, track the weights you used so you can progress next session. ' +
        'Seventh, get at least eight hours of sleep to aid recovery. ' +
        'Eighth, deload every fourth week.'
      );
      const shaped = shapeCoachResponse(input, { emoji: false });
      expect(shaped).toMatch(/^1\./m);
      expect(shaped).toMatch(/^2\./m);
    });

    test('does not renumber an existing numbered list', () => {
      const input = (
        '1. First step.\n2. Second step.\n3. Third step.\n\n' +
        'Follow the sequence strictly. It helps with motor learning. ' +
        'It also prevents injury. Stay consistent for best results. ' +
        'Review your progress weekly. Adjust weights based on how you feel.'
      );
      const shaped = shapeCoachResponse(input, { emoji: false });
      // First three items should remain "1." "2." "3." with their original text.
      expect(shaped).toMatch(/1\. First step/);
      expect(shaped).toMatch(/2\. Second step/);
      expect(shaped).toMatch(/3\. Third step/);
    });
  });

  describe('idempotence', () => {
    test('shaping a shaped response is a no-op', () => {
      const input = (
        'Here is a workout. Do 4x8 @ 165lb on day one. ' +
        'Then 3x5 @ 185lb on day two. Then 3x3 @ 205lb on day three. ' +
        'Deload every fourth week. Aim for adequate protein intake.'
      );
      const once = shapeCoachResponse(input);
      const twice = shapeCoachResponse(once);
      expect(twice).toBe(once);
    });
  });

  describe('edge cases', () => {
    test('handles input with only whitespace sentences', () => {
      expect(shapeCoachResponse('   \n\n   ')).toBe('');
    });

    test('does not inject emoji for single set pattern (not a list)', () => {
      const input = 'Do 3x8 at 60 percent for a warm-up set today.';
      const shaped = shapeCoachResponse(input, { emoji: false });
      // No bullet rendering because only one set pattern matched.
      expect(shaped).not.toMatch(/^- \d+x\d+/m);
    });
  });
});
