const config = {
  preset: 'ts-jest',
  testEnvironment: 'node', 
  collectCoverage: true,  
  coverageDirectory: './coverage', 
  testTimeout: 10000,  
  transform: {
      '\\.ts$': 'ts-jest',
    },
  testMatch: ['**/*.test.ts'],
  verbose: false,
  roots: ['tests'],
  maxWorkers: 1,
};

module.exports = config;