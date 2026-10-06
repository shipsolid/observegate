import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "packages/action/lib/**", "**/coverage/**", ".superpowers/**"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict
);
