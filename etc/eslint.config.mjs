import path from 'node:path';
import { fileURLToPath } from 'node:url';
import expo from 'eslint-config-expo/flat.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export default [
  ...expo,
  {
    ignores: ['dist/*'],
  },
  {
    languageOptions: {
      parserOptions: {
        project: path.join(rootDir, 'tsconfig.json'),
        tsconfigRootDir: rootDir,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: path.join(rootDir, 'tsconfig.json'),
        },
      },
    },
  },
];
