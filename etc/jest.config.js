/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.{ts,tsx}',
    '<rootDir>/lib/**/*.test.{ts,tsx}',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|moti)',
  ],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'contexts/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 10,
      lines: 10,
      statements: 10,
    },
  },
  coverageReporters: ['text', 'text-summary', 'lcov'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
