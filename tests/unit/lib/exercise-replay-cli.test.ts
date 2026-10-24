import { spawnSync } from 'node:child_process';

describe('exercise replay CLI', () => {
  it('explains the controller boundary without loading a camera or app', () => {
    const result = spawnSync('bun', ['scripts/replay-exercise.ts', '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('controller-input');
    expect(result.stdout).toContain('--output=');
  });
  it('rejects a missing input file with a nonzero exit', () => {
    const result = spawnSync('bun', ['scripts/replay-exercise.ts', '/does-not-exist/replay.json'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot read recording');
  });
});
