import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jestPlugin from "eslint-plugin-jest";
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "dump/**"]
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.browser
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "jest": jestPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }], // Downgrade to warn for now
      "no-console": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-undef": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-async-promise-executor": "warn"
    }
  },
  {
    files: ["test/**/*.spec.ts"],
    plugins: {
      "jest": jestPlugin
    },
    languageOptions: {
      globals: {
        ...globals.jest
      }
    },
    rules: {
      ...jestPlugin.configs.recommended.rules,
      "jest/no-done-callback": "off",
      "jest/no-conditional-expect": "off"
    }
  }
];
