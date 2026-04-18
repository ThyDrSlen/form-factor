import {
  formatGemmaMessages,
  mapCoachRoleToGemma,
  renderGemmaChatPrompt,
  validateGemmaFormat,
} from '@/lib/services/gemma-prompt-format';
import type { CoachMessage } from '@/lib/services/coach-service';

describe('mapCoachRoleToGemma', () => {
  it('maps assistant to model', () => {
    expect(mapCoachRoleToGemma('assistant')).toBe('model');
  });

  it('maps user to user', () => {
    expect(mapCoachRoleToGemma('user')).toBe('user');
  });

  it('maps system to system', () => {
    expect(mapCoachRoleToGemma('system')).toBe('system');
  });
});

describe('formatGemmaMessages for gemma-4', () => {
  it('preserves every role one-to-one', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'You are a fitness coach.' },
      { role: 'user', content: 'How do I squat?' },
      { role: 'assistant', content: 'Drive through your heels.' },
      { role: 'user', content: 'And my knees?' },
    ];
    const formatted = formatGemmaMessages(messages, 'gemma-4');
    expect(formatted).toEqual([
      { role: 'system', content: 'You are a fitness coach.' },
      { role: 'user', content: 'How do I squat?' },
      { role: 'model', content: 'Drive through your heels.' },
      { role: 'user', content: 'And my knees?' },
    ]);
  });

  it('keeps a system-only message as a native system turn', () => {
    const messages: CoachMessage[] = [{ role: 'system', content: 'Be concise.' }];
    const formatted = formatGemmaMessages(messages, 'gemma-4');
    expect(formatted).toEqual([{ role: 'system', content: 'Be concise.' }]);
  });
});

describe('formatGemmaMessages for gemma-3', () => {
  it('folds a single system turn into the first user turn', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'You are a fitness coach.' },
      { role: 'user', content: 'How do I squat?' },
    ];
    const formatted = formatGemmaMessages(messages, 'gemma-3');
    expect(formatted).toHaveLength(1);
    expect(formatted[0].role).toBe('user');
    expect(formatted[0].content).toContain('You are a fitness coach.');
    expect(formatted[0].content).toContain('How do I squat?');
  });

  it('concatenates multiple system turns before the first user turn', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'You are a fitness coach.' },
      { role: 'system', content: 'Keep answers under 120 words.' },
      { role: 'user', content: 'Tempo?' },
    ];
    const formatted = formatGemmaMessages(messages, 'gemma-3');
    expect(formatted[0].content).toContain('You are a fitness coach.');
    expect(formatted[0].content).toContain('Keep answers under 120 words.');
    expect(formatted[0].content).toContain('Tempo?');
  });

  it('injects system content before the first user turn but keeps subsequent turns intact', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'Context block.' },
      { role: 'user', content: 'First question.' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question.' },
    ];
    const formatted = formatGemmaMessages(messages, 'gemma-3');
    expect(formatted).toHaveLength(3);
    expect(formatted[0].content).toContain('Context block.');
    expect(formatted[0].content).toContain('First question.');
    expect(formatted[1].role).toBe('model');
    expect(formatted[2].content).toBe('Second question.');
  });

  it('synthesizes a lone user turn when the conversation begins with a system turn only', () => {
    const messages: CoachMessage[] = [{ role: 'system', content: 'Be brief.' }];
    const formatted = formatGemmaMessages(messages, 'gemma-3');
    expect(formatted).toEqual([{ role: 'user', content: 'Be brief.' }]);
  });

  it('produces no system turns', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 's1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ];
    const formatted = formatGemmaMessages(messages, 'gemma-3');
    expect(formatted.every((m) => m.role !== 'system')).toBe(true);
  });
});

describe('renderGemmaChatPrompt', () => {
  it('wraps each message in start/end turn markers and appends a trailing model turn', () => {
    const rendered = renderGemmaChatPrompt(
      [
        { role: 'user', content: 'hi' },
        { role: 'model', content: 'hello' },
        { role: 'user', content: 'what now?' },
      ],
      'gemma-4'
    );
    expect(rendered).toContain('<start_of_turn>user\nhi<end_of_turn>');
    expect(rendered).toContain('<start_of_turn>model\nhello<end_of_turn>');
    expect(rendered).toContain('<start_of_turn>user\nwhat now?<end_of_turn>');
    expect(rendered.endsWith('<start_of_turn>model\n')).toBe(true);
  });

  it('renders a system turn for gemma-4', () => {
    const rendered = renderGemmaChatPrompt(
      [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hi' },
      ],
      'gemma-4'
    );
    expect(rendered).toContain('<start_of_turn>system\nbe concise<end_of_turn>');
  });

  it('throws when a system turn appears on gemma-3', () => {
    expect(() =>
      renderGemmaChatPrompt(
        [
          { role: 'system', content: 'be concise' },
          { role: 'user', content: 'hi' },
        ],
        'gemma-3'
      )
    ).toThrow(/gemma-3/);
  });
});

describe('validateGemmaFormat', () => {
  it('accepts a well-formed gemma-4 prompt with a system turn', () => {
    const prompt = [
      '<start_of_turn>system\nyou are a coach<end_of_turn>',
      '<start_of_turn>user\nhello<end_of_turn>',
      '<start_of_turn>model\n',
    ].join('\n');
    expect(validateGemmaFormat(prompt, 'gemma-4')).toEqual({ valid: true, errors: [] });
  });

  it('accepts a well-formed gemma-3 prompt with no system turn', () => {
    const prompt = [
      '<start_of_turn>user\nhello<end_of_turn>',
      '<start_of_turn>model\n',
    ].join('\n');
    expect(validateGemmaFormat(prompt, 'gemma-3')).toEqual({ valid: true, errors: [] });
  });

  it('rejects a gemma-3 prompt that contains a system turn', () => {
    const prompt = [
      '<start_of_turn>system\nbe concise<end_of_turn>',
      '<start_of_turn>user\nhello<end_of_turn>',
      '<start_of_turn>model\n',
    ].join('\n');
    const result = validateGemmaFormat(prompt, 'gemma-3');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('gemma-3 does not support the system role');
  });

  it('rejects a prompt missing the trailing model turn', () => {
    const prompt = '<start_of_turn>user\nhello<end_of_turn>';
    const result = validateGemmaFormat(prompt, 'gemma-4');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('trailing turn');
  });

  it('rejects a prompt with no turn markers at all', () => {
    const result = validateGemmaFormat('just a bare string', 'gemma-4');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('no <start_of_turn>');
  });

  it('rejects a prompt with unbalanced markers', () => {
    const prompt = '<start_of_turn>user\nhello<start_of_turn>model\n';
    const result = validateGemmaFormat(prompt, 'gemma-4');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('unbalanced');
  });

  it('rejects a prompt with an unexpected role', () => {
    const prompt = [
      '<start_of_turn>custom\nnope<end_of_turn>',
      '<start_of_turn>model\n',
    ].join('\n');
    const result = validateGemmaFormat(prompt, 'gemma-4');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('unexpected role');
  });
});

describe('end-to-end formatting', () => {
  it('renders a coach-to-gemma-4 prompt that validates clean', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'You are a fitness coach.' },
      { role: 'user', content: 'How do I squat deeper?' },
    ];
    const gemma = formatGemmaMessages(messages, 'gemma-4');
    const prompt = renderGemmaChatPrompt(gemma, 'gemma-4');
    expect(validateGemmaFormat(prompt, 'gemma-4').valid).toBe(true);
  });

  it('renders a coach-to-gemma-3 prompt (system folded) that validates clean', () => {
    const messages: CoachMessage[] = [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Squat cue?' },
    ];
    const gemma = formatGemmaMessages(messages, 'gemma-3');
    const prompt = renderGemmaChatPrompt(gemma, 'gemma-3');
    expect(validateGemmaFormat(prompt, 'gemma-3').valid).toBe(true);
  });
});
