/**
 * Route-contract integration tests.
 *
 * These mount the production route composition with stubbed services and need
 * no running infrastructure, so they are safe to run anywhere. Live-persistence
 * suites live in jest.integration.persistence.config.cjs.
 *
 * @type {import("jest").Config}
 */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src/test"],
  testMatch: ["**/*.routes.integration.test.ts"],
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
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/test/db/"],
};
