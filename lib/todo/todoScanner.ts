const todoRegex = /^\s*\/\/\s*(TODO|FIXME|HACK):?\s*(.+)$/;

export type TodoMatch = {
  filePath: string;
  line: number;
  tag: 'TODO' | 'FIXME' | 'HACK';
  text: string;
};

export function scanTodoLines(filePath: string, content: string): TodoMatch[] {
  return content.split('\n').flatMap((lineText, index) => {
    const match = lineText.match(todoRegex);
    if (!match) {
      return [];
    }
    const tag = match[1] as TodoMatch['tag'];
    const text = match[2].trim();
    return [{ filePath, line: index + 1, tag, text }];
  });
}
