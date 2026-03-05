module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@novel-factory/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@novel-factory/memory$': '<rootDir>/../../packages/memory/src/index.ts',
    '^@novel-factory/llm$': '<rootDir>/../../packages/llm/src/index.ts',
  },
};
