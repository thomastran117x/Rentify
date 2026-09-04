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
  setupFiles: ["<rootDir>/src/test/support/env-setup.cjs"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/test/db/",
    "/src/test/openapi/",
    "\\.integration\\.test\\.ts$",
  ],
  collectCoverageFrom: [
    "src/app/**/*.ts",
    "!src/app/generated/**",
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
