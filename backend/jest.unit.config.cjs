/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  testMatch: ["**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@/configuration/environment$":
      "<rootDir>/src/test/support/environment-stub.ts",
    "^@/configuration/environment/index$":
      "<rootDir>/src/test/support/environment-stub.ts",
    "^@/(.*)$": "<rootDir>/src/app/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/test/db/",
    "/src/test/openapi/",
    "\\.integration\\.test\\.ts$",
  ],
  collectCoverageFrom: [
    "src/app/**/*.ts",
    "!src/app/server.ts",
    "!src/app/scripts/**",
    "!src/app/seeds/**",
    "!src/app/workers/**",
    "!src/app/openapi/**",
    "!src/app/**/*.model.ts",
    "!src/app/**/*.types.ts",
    "!src/app/**/index.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      lines: 90,
      functions: 90,
      branches: 75,
    },
  },
};
