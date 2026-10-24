import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseExerciseRecording } from '../lib/debug/exercise-replay';

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log('Usage: bun run replay:exercise recording.json [--output=report.json]\n' +
    'Replays controller-input recordings through the real workout controller twice.\n' +
    'Checks deterministic phases/FQI/reps and optional expectedRepCount. No camera or workout writes.\n' +
    'Synthetic fixtures prove regression behavior, not physical-device accuracy.');
  process.exit(args.includes('--help') ? 0 : 1);
}
if (args.length > 2 || (args[1] !== undefined && !args[1].startsWith('--output='))) {
  console.error('Expected recording.json and optional --output=report.json');
  process.exit(1);
}
const inputPath = resolve(args[0]);
try {
  parseExerciseRecording(JSON.parse(readFileSync(inputPath, 'utf8')));
} catch (error) {
  console.error('Cannot read recording:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const output = args[1]?.slice('--output='.length);
if (output !== undefined && (!output || resolve(output) === inputPath)) {
  console.error('Report output must be nonempty and different from the input recording');
  process.exit(1);
}
// The app controller is a React Native hook. Use the existing Jest/Expo runtime,
// not a second implementation of rep counting or scoring in a Node-only CLI.
const result = spawnSync('bun', [
  'run', 'test', '--runInBand', '--runTestsByPath', 'tests/integration/exercise-replay.test.tsx',
], {
  stdio: 'inherit',
  env: { ...process.env, FF_REPLAY_FILE: inputPath, FF_REPLAY_REPORT: output ? resolve(output) : '' },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
