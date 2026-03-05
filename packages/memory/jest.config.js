module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@novel-factory/shared$': '<rootDir>/../shared/src/index.ts',
  },
};
