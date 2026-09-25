import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", ".venv/**", "coverage/**", "next-env.d.ts", "eval/results/**", "data/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Security: rendering untrusted text (LLM output, campaign names) as HTML is banned.
      "react/no-danger": "error",
    },
  },
];
export default config;
