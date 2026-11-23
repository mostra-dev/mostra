// ESLint runs only the React hooks rules; Biome does everything else (REPO_STANDARDS §4).
// It lives here because typescript-eslint needs TypeScript 6's compiler API.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    // The git-ignored scratch (`temp/`) can hold whole worktrees: walking it ran ESLint out of
    // memory (MT-07's baseline).
    ignores: [
      "**/dist/**",
      "**/.tsbuild/**",
      "**/node_modules/**",
      "**/fixtures/**",
      "docs/**",
      "temp/**",
      "packages/*/temp/**",
    ],
  },
  {
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "plugins/*/src/**/*.{ts,tsx}",
      "apps/*/src/**/*.{ts,tsx}",
    ],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
