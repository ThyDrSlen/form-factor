import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { scanTodoLines, type TodoMatch } from '@/lib/todo/todoScanner';

const TODO_LABEL = 'todo';
const AUTO_LABEL = 'auto-generated';
const DEFAULT_ASSIGNEE = 'ThyDrSlen';
const TODO_ID_REGEX = /<!--\s*todo-id:\s*([a-f0-9]+)\s*-->/i;

const allowedExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.swift',
  '.m',
  '.mm',
]);

type TodoIssue = {
  todoId: string;
  title: string;
  body: string;
  assignees: string[];
};

type ExistingIssue = {
  id: number;
  number: number;
  todoId: string;
  title: string;
  state: 'open' | 'closed';
};

export function diffTodoIssues(
  existing: { todoId: string }[],
  current: { todoId: string }[],
) {
  const existingIds = new Set(existing.map((issue) => issue.todoId));
  const currentIds = new Set(current.map((todo) => todo.todoId));

  return {
    toCreate: current
      .filter((todo) => !existingIds.has(todo.todoId))
      .map((todo) => todo.todoId),
    toClose: existing
      .filter((issue) => !currentIds.has(issue.todoId))
      .map((issue) => issue.todoId),
  };
}

function getRepository() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY is required');
  }
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repo}`);
  }
  return { owner, name };
}

function getApiBase() {
  return process.env.GITHUB_API_URL ?? 'https://api.github.com';
}

function getAuthHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function buildTodoId(filePath: string, text: string) {
  return createHash('sha1').update(`${filePath}|${text}`).digest('hex');
}

function buildTodoIssue(todo: TodoMatch): TodoIssue {
  const todoId = buildTodoId(todo.filePath, todo.text);
  const title = `${todo.tag}: ${todo.text}`;
  const body = [
    `<!-- todo-id: ${todoId} -->`,
    '',
    `**File:** \`${todo.filePath}\``,
    `**Line:** ${todo.line}`,
    `**Tag:** ${todo.tag}`,
    '',
    `> // ${todo.tag}: ${todo.text}`,
  ].join('\n');

  return {
    todoId,
    title,
    body,
    assignees: [DEFAULT_ASSIGNEE],
  };
}

function parseTodoId(body?: string | null) {
  if (!body) {
    return null;
  }
  const match = body.match(TODO_ID_REGEX);
  return match ? match[1] : null;
}

function getTrackedFiles() {
  const output = execSync('git ls-files', {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => allowedExtensions.has(path.extname(file)));
}

async function scanTodos(): Promise<TodoIssue[]> {
  const files = getTrackedFiles();
  const todoIssues: TodoIssue[] = [];

  for (const filePath of files) {
    const contents = await readFile(filePath, 'utf8');
    const matches = scanTodoLines(filePath, contents);
    matches.forEach((match) => {
      todoIssues.push(buildTodoIssue(match));
    });
  }

  return todoIssues;
}

async function ensureLabel(
  name: string,
  color: string,
  description: string,
) {
  const { owner, name: repo } = getRepository();
  const response = await fetch(`${getApiBase()}/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name,
      color,
      description,
    }),
  });

  if (response.ok || response.status === 422) {
    return;
  }

  const message = await response.text();
  throw new Error(`Failed to create label ${name}: ${response.status} ${message}`);
}

async function listTodoIssues(): Promise<ExistingIssue[]> {
  const { owner, name: repo } = getRepository();
  const issues: ExistingIssue[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const url = new URL(`${getApiBase()}/repos/${owner}/${repo}/issues`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('labels', TODO_LABEL);
    url.searchParams.set('per_page', perPage.toString());
    url.searchParams.set('page', page.toString());

    const response = await fetch(url.toString(), {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Failed to list issues: ${response.status} ${message}`);
    }

    const data = (await response.json()) as Array<
      ExistingIssue & { body?: string | null; pull_request?: unknown }
    >;

    const filtered = data.filter((issue) => !issue.pull_request);
    filtered.forEach((issue) => {
      const todoId = parseTodoId(issue.body);
      if (!todoId) {
        return;
      }
      issues.push({
        id: issue.id,
        number: issue.number,
        todoId,
        title: issue.title,
        state: issue.state,
      });
    });

    if (data.length < perPage) {
      break;
    }
    page += 1;
  }

  return issues;
}

async function createIssue(todo: TodoIssue) {
  const { owner, name: repo } = getRepository();
  const response = await fetch(`${getApiBase()}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      title: todo.title,
      body: todo.body,
      labels: [TODO_LABEL, AUTO_LABEL],
      assignees: todo.assignees,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to create issue: ${response.status} ${message}`);
  }
}

async function closeIssue(issue: ExistingIssue) {
  const { owner, name: repo } = getRepository();
  const headers = getAuthHeaders();

  const commentResponse = await fetch(
    `${getApiBase()}/repos/${owner}/${repo}/issues/${issue.number}/comments`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        body: 'Closing automatically because the TODO was removed.',
      }),
    },
  );

  if (!commentResponse.ok) {
    const message = await commentResponse.text();
    throw new Error(`Failed to comment on issue: ${commentResponse.status} ${message}`);
  }

  const closeResponse = await fetch(
    `${getApiBase()}/repos/${owner}/${repo}/issues/${issue.number}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ state: 'closed' }),
    },
  );

  if (!closeResponse.ok) {
    const message = await closeResponse.text();
    throw new Error(`Failed to close issue: ${closeResponse.status} ${message}`);
  }
}

async function syncTodoIssues() {
  await ensureLabel(TODO_LABEL, 'fef2c0', 'Tracked TODOs from code');
  await ensureLabel(AUTO_LABEL, 'c5def5', 'Auto-generated issue');

  const todos = await scanTodos();
  const existingIssues = await listTodoIssues();

  const todoById = new Map(todos.map((todo) => [todo.todoId, todo]));
  const issueById = new Map(existingIssues.map((issue) => [issue.todoId, issue]));

  const diff = diffTodoIssues(existingIssues, todos);

  for (const todoId of diff.toCreate) {
    const todo = todoById.get(todoId);
    if (!todo) {
      continue;
    }
    await createIssue(todo);
  }

  for (const todoId of diff.toClose) {
    const issue = issueById.get(todoId);
    if (!issue) {
      continue;
    }
    await closeIssue(issue);
  }

  return {
    created: diff.toCreate.length,
    closed: diff.toClose.length,
    total: todos.length,
  };
}

async function main() {
  try {
    const result = await syncTodoIssues();
    console.log(
      `[TodoIssueSync] created=${result.created} closed=${result.closed} total=${result.total}`,
    );
  } catch (error) {
    console.error('[TodoIssueSync] Failed to sync TODO issues', error);
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('todo-issue-sync.ts') ||
  process.argv[1]?.endsWith('todo-issue-sync.js');

if (isDirectRun) {
  void main();
}
