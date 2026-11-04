/** Three projects: pure unit tests, DB-backed integration tests, full-stack e2e journeys. */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] },
  rootDir: '.',
  setupFiles: ['<rootDir>/test/env.setup.ts'],
};
module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      testPathIgnorePatterns: ['\\.int\\.spec\\.ts$', '\\.e2e\\.spec\\.ts$'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int.spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      testTimeout: 30000,
    },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e.spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      testTimeout: 60000,
    },
  ],
};
