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
          // Support React Native platform-specific extensions
          extensions: ['.ios.ts', '.ios.tsx', '.android.ts', '.android.tsx', '.native.ts', '.native.tsx', '.web.ts', '.web.tsx', '.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      },
    },
  },
];
