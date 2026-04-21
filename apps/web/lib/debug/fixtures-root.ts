import path from 'node:path';

export function fixturesRoot(): string {
  return path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures');
}

export function isDevOnly(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_FIXTURES !== '1';
}
