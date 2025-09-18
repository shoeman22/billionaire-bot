module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.spec.ts',
    '**/integration/**/*.test.ts',
    '**/mocks/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
    '!src/main.ts',
    '!src/scripts/**',
    '!src/types/**'
  ],
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    },
    // Critical components require higher coverage
    'src/trading/risk/': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    },
    'src/api/GalaSwapClient.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    'src/utils/signing.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 30000,
  verbose: true,
  collectCoverage: false, // Enable only when explicitly requested
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: false
    }]
  }
};