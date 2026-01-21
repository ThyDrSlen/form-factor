import { scanTodoLines } from '@/lib/todo/todoScanner';

describe('scanTodoLines', () => {
  it('parses TODO/FIXME/HACK with line numbers', () => {
    const content = [
      'const a = 1;',
      '// TODO: Implement password reset logic',
      '  // FIXME: handle edge case',
      '// HACK: temporary workaround',
    ].join('\n');

    expect(scanTodoLines('app/example.tsx', content)).toEqual([
      {
        filePath: 'app/example.tsx',
        line: 2,
        tag: 'TODO',
        text: 'Implement password reset logic',
      },
      {
        filePath: 'app/example.tsx',
        line: 3,
        tag: 'FIXME',
        text: 'handle edge case',
      },
      {
        filePath: 'app/example.tsx',
        line: 4,
        tag: 'HACK',
        text: 'temporary workaround',
      },
    ]);
  });
});
