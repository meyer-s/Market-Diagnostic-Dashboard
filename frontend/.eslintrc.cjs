module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  extends: ["plugin:jsx-a11y/recommended"],
  plugins: ["react-refresh", "jsx-a11y"],
  ignorePatterns: ["dist", "coverage", "playwright-report"],
  rules: {
    "react-refresh/only-export-components": "off",
    "jsx-a11y/no-noninteractive-tabindex": [
      "error",
      { roles: ["region", "tabpanel", "navigation"], tags: ["nav"] },
    ],
  },
};
