module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.env.cjs'],
  // Jest's 5s default is shorter than MongoClient's own 30s server-selection timeout, so a slow
  // or unreachable database both surfaced identically as "Exceeded timeout of 5000 ms for a
  // hook" -- no server address, no refusal, nothing to act on. A local Mongo is warm and always
  // beat it; a CI service container on a cold first connect does not. Raising the ceiling does
  // not slow a passing test, and it lets the driver report its own failure.
  testTimeout: 30000,
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'node'
        }
      },
    ],
  },
};
