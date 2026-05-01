import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "eslint.config.js",
      "scripts/**/*.mjs",
      "src/runtime/worker/symbol-worker-entry.mjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**"],
              message:
                "domain must not import infrastructure (hexagonal layering — see DEVELOPERS.md)",
            },
            {
              group: ["**/runtime/**"],
              message:
                "domain must not import runtime (hexagonal layering — see DEVELOPERS.md)",
            },
            {
              group: ["**/application/**"],
              message:
                "domain must not import application (hexagonal layering — see DEVELOPERS.md)",
            },
            {
              group: ["**/config/**"],
              message:
                "domain must not import config loading (hexagonal layering — see DEVELOPERS.md)",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/ports/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**"],
              message:
                "ports must not import infrastructure (keep interfaces pure — see DEVELOPERS.md)",
            },
            {
              group: ["**/runtime/**"],
              message:
                "ports must not import runtime (keep interfaces pure — see DEVELOPERS.md)",
            },
          ],
        },
      ],
    },
  },
);
