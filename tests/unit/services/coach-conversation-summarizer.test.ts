import {
  summarizeRollingWindow,
  type Message,
} from '@/lib/services/coach-conversation-summarizer';

function mkUser(content: string): Message {
  return { role: 'user', content };
}
function mkAssistant(content: string): Message {
  return { role: 'assistant', content };
}
function mkSystem(content: string): Message {
  return { role: 'system', content };
}

describe('coach-conversation-summarizer', () => {
  describe('no-op paths', () => {
    test('empty or nullish input returns empty array', () => {
      expect(summarizeRollingWindow([])).toEqual([]);
      expect(summarizeRollingWindow(null as never)).toEqual([]);
      expect(summarizeRollingWindow(undefined as never)).toEqual([]);
    });

    test('short history below threshold is returned unchanged', () => {
      const history: Message[] = [
        mkUser('hi'),
        mkAssistant('hello'),
        mkUser('thanks'),
      ];
      const out = summarizeRollingWindow(history);
      expect(out).toEqual(history);
      // Shallow copy — not the same reference.
      expect(out).not.toBe(history);
    });

    test('returns same message ordering when under threshold', () => {
      const history: Message[] = Array.from({ length: 7 }, (_, i) =>
        i % 2 === 0 ? mkUser(`q${i}`) : mkAssistant(`a${i}`)
      );
      expect(summarizeRollingWindow(history)).toEqual(history);
    });
  });

  describe('summarization', () => {
    test('collapses oldest turns past threshold into a summary bullet', () => {
      const history: Message[] = [
        mkUser('how do I squat better?'),
        mkAssistant('Brace your core and drive through your heels.'),
        mkUser('anything on pushups?'),
        mkAssistant('Keep your elbows 45 degrees off your body.'),
        mkUser('deadlift grip?'),
        mkAssistant('Use a mixed or hook grip.'),
        mkUser('nutrition for bulking?'),
        mkAssistant('Aim for 2800 calories with 180g protein.'),
        mkUser('sleep tips?'),
        mkAssistant('Eight hours minimum and a dark room.'),
      ];
      const out = summarizeRollingWindow(history, { keepLast: 4, summarizeBelow: 8 });
      expect(out.length).toBeLessThan(history.length);
      // First message after any system head should be the summary.
      const first = out[0];
      expect(first.role).toBe('system');
      expect(first.content).toContain('[conversation summary]');
      // And it should mention at least one of the detected topics.
      expect(first.content).toMatch(/squat|deadlift|nutrition|pushups/i);
    });

    test('preserves system head verbatim', () => {
      const history: Message[] = [
        mkSystem('You are a fitness coach.'),
        mkUser('q1'),
        mkAssistant('a1'),
        mkUser('q2'),
        mkAssistant('a2'),
        mkUser('q3'),
        mkAssistant('a3'),
        mkUser('q4'),
        mkAssistant('a4'),
        mkUser('q5'),
      ];
      const out = summarizeRollingWindow(history, { keepLast: 4, summarizeBelow: 8 });
      expect(out[0]).toEqual(mkSystem('You are a fitness coach.'));
      // Next should be the summary.
      expect(out[1].role).toBe('system');
      expect(out[1].content).toContain('[conversation summary]');
    });

    test('always keeps the most recent keepLast messages', () => {
      const history: Message[] = Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? mkUser(`user msg ${i}`) : mkAssistant(`assistant msg ${i}`)
      );
      const out = summarizeRollingWindow(history, { keepLast: 3, summarizeBelow: 5 });
      const tail = out.slice(-3);
      expect(tail).toEqual(history.slice(-3));
    });

    test('counts user turns only when building the turn phrase', () => {
      const history: Message[] = [
        mkUser('q1 about squats'),
        mkAssistant('a1'),
        mkUser('q2 about squats'),
        mkAssistant('a2'),
        mkUser('q3 about squats'),
        mkAssistant('a3'),
        mkUser('q4 recent'),
        mkAssistant('a4 recent'),
      ];
      const out = summarizeRollingWindow(history, { keepLast: 2, summarizeBelow: 6 });
      const summary = out.find(
        (m) => m.role === 'system' && m.content.includes('[conversation summary]')
      );
      expect(summary).toBeDefined();
      // 3 user turns were summarized.
      expect(summary?.content).toMatch(/3 turns ago/);
    });

    test('handles unknown topics gracefully', () => {
      const history: Message[] = Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? mkUser(`random msg ${i}`) : mkAssistant(`reply ${i}`)
      );
      const out = summarizeRollingWindow(history, { keepLast: 4, summarizeBelow: 8 });
      const summary = out.find((m) => m.content.includes('[conversation summary]'));
      expect(summary?.content).toMatch(/earlier coaching discussion/);
    });
  });

  describe('option guards', () => {
    test('keepLast clamps to at least 1', () => {
      const history: Message[] = Array.from({ length: 10 }, (_, i) => mkUser(`q${i}`));
      const out = summarizeRollingWindow(history, { keepLast: 0, summarizeBelow: 5 });
      // tail kept = max(1, 0) = 1
      expect(out[out.length - 1]).toEqual(history[9]);
    });

    test('summarizeBelow is clamped above keepLast', () => {
      const history: Message[] = Array.from({ length: 10 }, (_, i) => mkUser(`q${i}`));
      // keepLast: 5, summarizeBelow passed as 3 → clamps to keepLast + 1 = 6
      const out = summarizeRollingWindow(history, { keepLast: 5, summarizeBelow: 3 });
      // Should summarize since 10 >= 6.
      const summary = out.find((m) => m.content.includes('[conversation summary]'));
      expect(summary).toBeDefined();
    });
  });
});
