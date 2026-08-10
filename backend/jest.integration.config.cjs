/**
 * Integration tests.
 *
 * Every integration suite runs the production application composition against
 * real MySQL, Redis, Elasticsearch, and RabbitMQ, so they require the Docker
 * Compose stack and a migrated `rent_test` schema. There is no mocked-
 * infrastructure variant: third-party providers (payments, OAuth, captcha,
 * blob storage, SMS) are stubbed, but everything the application owns is real.
 *
 * @type {import("jest").Config}
 */
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
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/test/db/"],
  // These suites share one `rent_test` schema and one Redis database, and each
  // `beforeEach` truncates and reseeds both. They must not run concurrently,
  // regardless of how Jest is invoked.
  maxWorkers: 1,
};
