/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '@exodus/bytes': '<rootDir>/tests/__mocks__/exodus-bytes.js',
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  testMatch: ['**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(@asamuzakjp|css-color))'
  ],
};

export default config;
