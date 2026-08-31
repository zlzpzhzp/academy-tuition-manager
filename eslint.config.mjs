import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  globalIgnores([
    ".next/**",
    // 빌드·릴리스 분리(2026-08-01): 배포는 .next-<sha> 로 빌드한다. 이걸 안 빼면
    // 다음 배포의 lint 게이트가 **직전 빌드 산출물**을 검사하다 실패한다(실제로 한 번 막혔다).
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "src/coverage/**",
    "src/node_modules/**",
  ]),
]);

export default eslintConfig;
