import { diffTodoIssues } from '@/scripts/todo-issue-sync';

describe('diffTodoIssues', () => {
  it('returns todo ids to create and close', () => {
    const existingIssues = [
      { id: 1, todoId: 'abc', title: 'TODO: Existing', state: 'open' },
      { id: 2, todoId: 'old', title: 'TODO: Old', state: 'open' },
    ];

    const currentTodos = [
      {
        todoId: 'abc',
        title: 'TODO: Existing',
        body: '...',
        assignees: ['ThyDrSlen'],
      },
      {
        todoId: 'new',
        title: 'TODO: New',
        body: '...',
        assignees: ['ThyDrSlen'],
      },
    ];

    expect(diffTodoIssues(existingIssues, currentTodos)).toEqual({
      toCreate: ['new'],
      toClose: ['old'],
    });
  });
});
