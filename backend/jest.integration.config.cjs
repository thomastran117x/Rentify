/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  testMatch: ["**/*.integration.test.ts"],
  setupFiles: ["<rootDir>/src/test/support/env-setup.cjs"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/app/$1",
  },
  transform: {
    "^.+\.ts$": [
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
    "\.mocked\.integration\.test\.ts$",
    "\.routes\.integration\.test\.ts$",
  ],
};
