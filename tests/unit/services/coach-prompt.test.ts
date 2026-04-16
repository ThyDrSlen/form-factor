import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SYSTEM_PROMPT_CLAUSES,
  buildSystemMessages,
  renderGemmaChat,
  sanitizeMessages,
  sanitizeName,
} from '@/lib/services/coach-prompt';

describe('coach-prompt / SYSTEM_PROMPT_CLAUSES', () => {
  /**
   * Locked literal — if any value drifts from cloud `buildPrompt()` we fail.
   * See `supabase/functions/coach/index.ts`.
   */
  const EXPECTED_CLAUSES: readonly string[] = [
    'You are Form Factor\u2019s AI coach for strength, conditioning, mobility, and nutrition.',
    '__USER_LINE__',
    'Stay safe: avoid medical advice, do not invent injuries, and recommend seeing a physician for pain, dizziness, or medical issues.',
    'Do not mention that you are an AI or language model.',
    'Outputs must be concise (under ~180 words) and actionable with clear sets/reps, rest, tempo, or food swaps.',
    'Prefer simple movements with minimal equipment unless the user specifies otherwise.',
    'Offer 1-2 options max; avoid long lists.',
    'If user asks for calorie/protein guidance, give estimates and ranges, not exact prescriptions.',
  ];

  it('has the 8 canonical entries (7 safety/format clauses + user-line slot)', () => {
    expect(SYSTEM_PROMPT_CLAUSES).toHaveLength(EXPECTED_CLAUSES.length);
  });

  it('matches the expected literal strings byte-for-byte', () => {
    // Spread so Jest prints the whole diff if drift occurs.
    expect([...SYSTEM_PROMPT_CLAUSES]).toEqual([...EXPECTED_CLAUSES]);
  });

  it('is frozen so downstream code cannot mutate it', () => {
    expect(Object.isFrozen(SYSTEM_PROMPT_CLAUSES)).toBe(true);
  });
});

describe('coach-prompt / cloud eval yaml lock', () => {
  const yamlPath = join(process.cwd(), 'evals', 'coach-eval.yaml');
  const yaml = readFileSync(yamlPath, 'utf-8');

  /**
   * Each safety/format assertion in `evals/coach-eval.yaml` maps to a
   * statement the system prompt enforces. If a clause disappears we want
   * this test to flag it loudly.
   */
  const safetyAssertionRules: { value: string; clauseSubstring: string }[] = [
    {
      value: "I'm just an AI",
      clauseSubstring: 'Do not mention that you are an AI or language model.',
    },
    {
      value: 'medical diagnosis',
      clauseSubstring: 'avoid medical advice',
    },
    {
      value: 'you need to see a doctor immediately and stop all exercise',
      clauseSubstring: 'recommend seeing a physician',
    },
    {
      value: 'ignore the pain',
      clauseSubstring: 'recommend seeing a physician for pain',
    },
    {
      value: 'push through the injury',
      clauseSubstring: 'do not invent injuries',
    },
  ];

  const clauseBlob = SYSTEM_PROMPT_CLAUSES.join(' ');

  it('eval yaml references each safety assertion the prompt claims to enforce', () => {
    for (const rule of safetyAssertionRules) {
      expect(yaml).toContain(rule.value);
      expect(clauseBlob).toContain(rule.clauseSubstring);
    }
  });

  it('format/length clauses are present in both yaml and prompt', () => {
    expect(yaml).toContain('Format/Length');
    expect(yaml).toContain('Format/WordCount');
    expect(clauseBlob).toContain('concise (under ~180 words)');
  });
});

describe('coach-prompt / sanitizeName', () => {
  it('strips delimiter characters used in prompt injection', () => {
    expect(sanitizeName('Bob<script>')).toBe('Bobscript');
  });

  it('preserves common name punctuation', () => {
    expect(sanitizeName("Mary-Jane O'Brien")).toBe("Mary-Jane O'Brien");
  });

  it('caps length at 100 chars', () => {
    expect(sanitizeName('A'.repeat(200)).length).toBe(100);
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeName('  John  ')).toBe('John');
  });
});

describe('coach-prompt / sanitizeMessages', () => {
  it('filters non-string content and normalises roles', () => {
    const out = sanitizeMessages([
      { role: 'user', content: 'a' },
      // @ts-expect-error intentional bad input
      { role: 'admin', content: 'b' },
      // @ts-expect-error intentional bad input
      { role: 'user', content: 123 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('user');
  });

  it('keeps only the last 12 messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    const out = sanitizeMessages(messages);
    expect(out).toHaveLength(12);
    expect(out[0].content).toBe('m8');
    expect(out[11].content).toBe('m19');
  });

  it('truncates content to 1200 chars', () => {
    const out = sanitizeMessages([{ role: 'user', content: 'x'.repeat(2000) }]);
    expect(out[0].content.length).toBe(1200);
  });
});

describe('coach-prompt / buildSystemMessages', () => {
  it('returns exactly one system-role message', () => {
    const out = buildSystemMessages({ focus: 'nutrition' });
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('system');
  });

  it('uses the fallback user line when name is missing', () => {
    const { content } = buildSystemMessages({})[0];
    expect(content).toContain('You are coaching the user.');
  });

  it('inserts a sanitised user name when provided', () => {
    const { content } = buildSystemMessages({
      profile: { name: 'Alice<script>' },
    })[0];
    expect(content).toContain('You are coaching Alicescript.');
    expect(content).not.toContain('<script>');
  });

  it('defaults focus to fitness_coach', () => {
    const { content } = buildSystemMessages()[0];
    expect(content).toContain('Focus: fitness_coach.');
  });

  it('prepends historySummary when supplied', () => {
    const { content } = buildSystemMessages({
      historySummary: 'Last 3 sessions focused on squats.',
    })[0];
    expect(content.startsWith('Recent training context:')).toBe(true);
  });
});

describe('coach-prompt / renderGemmaChat', () => {
  it('uses Gemma turn markers and labels assistant as "model"', () => {
    const rendered = renderGemmaChat(
      [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
      { focus: 'fitness_coach' }
    );

    expect(rendered).toContain('<start_of_turn>user\n');
    expect(rendered).toContain('<end_of_turn>\n');
    expect(rendered).toContain('<start_of_turn>model\n');
    // Must end with an open model turn so the runtime knows to generate.
    expect(rendered.endsWith('<start_of_turn>model\n')).toBe(true);
  });

  it('embeds system prompt inside the first user turn', () => {
    const rendered = renderGemmaChat([{ role: 'user', content: 'Plan my day' }]);
    expect(rendered).toContain('Form Factor');
    expect(rendered).toContain('Plan my day');
  });

  it('produces a standalone user turn when messages is empty', () => {
    const rendered = renderGemmaChat([]);
    expect(rendered).toContain('<start_of_turn>user\n');
    expect(rendered.endsWith('<start_of_turn>model\n')).toBe(true);
  });
});
