/** @type {import('jest').Config} */
const config = {
  preset: 'jest-expo',

  // Resolve @/ aliases — mirrors tsconfig.json paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Exclude generated/build artifacts and Expo's own cache
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
    '/.expo/',
  ],

  // Collect coverage from source files only (exclude tests, type-only files)
  collectCoverageFrom: [
    'engine/**/*.{ts,tsx}',
    'services/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    '!**/__tests__/**',
    '!**/*.d.ts',
    '!**/types.ts',
  ],

  // Engine determinism core: held to 100% per spec/test-plan.md §5
  coverageThreshold: {
    './engine/rng.ts': {
      lines: 100,
      branches: 100,
    },
    './engine/stats.ts': {
      lines: 100,
      branches: 100,
    },
    './engine/battle.ts': {
      lines: 100,
      branches: 100,
    },
  },

  // Allow Jest to transform RN / Expo packages that ship untransformed ESM.
  // Uses the canonical jest-expo pattern that whitelists the full Expo + RN ecosystem,
  // including expo-modules-core which ships ESM web entry points.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))',
  ],
};

module.exports = config;
