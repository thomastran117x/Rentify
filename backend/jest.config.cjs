/**
 * Default suite: unit tests plus the OpenAPI document checks, excluding every
 * integration suite. `npm run test:unit` is the same set with coverage
 * thresholds applied.
 *
 * @type {import('jest').Config}
 */
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
    "^.+\\.[cm]?[jt]s$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  // `cookie` v2 publishes ESM only. These suites execute as CommonJS, so that
  // ESM has to be down-levelled on the way in, which means opting the package
  // out of the default "never transform node_modules" rule.
  transformIgnorePatterns: ["/node_modules/(?!(cookie)/)"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/test/db/",
    "\\.integration\\.test\\.ts$",
  ],
};
