import { fixupConfigRules } from "@eslint/compat";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ESLint 10 removed the legacy rule context methods (`context.getFilename()`
// and friends). `eslint-config-next` still pulls in `eslint-plugin-react`,
// whose latest release (7.37.5) declares `eslint: ^3 || ... || ^9.7` and calls
// those methods, so loading `react/display-name` throws outright. Until that
// plugin ships ESLint 10 support, `fixupConfigRules` wraps the bundled rules
// in a context proxy that restores the removed methods. Drop this once
// `eslint-config-next` depends on an ESLint 10-compatible plugin.
const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  // ESLint 10 requires eslint-plugin-react-hooks >= 7.1, which turns on three
  // rules that did not exist in the 7.0 the repo was linting against. They
  // report 48 genuine findings across 26 components — refs read during render,
  // values mutated during render, and setState called synchronously in an
  // effect. Each one is a real behavioural change to make, not a mechanical
  // fix, so they are warnings here to keep the toolchain upgrade separable
  // from the refactor. Restore them to "error" as the components are cleaned
  // up.
  {
    name: "rentify/react-hooks-7.1-migration",
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
