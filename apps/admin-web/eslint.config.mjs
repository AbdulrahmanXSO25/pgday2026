import nextConfig from "eslint-config-next";
import nextTypeScriptConfig from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextConfig,
  ...nextTypeScriptConfig,
  {
    ignores: ["node_modules/**", ".next/**", ".open-next/**", "out/**", "next-env.d.ts"],
  },
  {
    rules: { "@next/next/no-img-element": "off" },
  },
];

export default eslintConfig;
