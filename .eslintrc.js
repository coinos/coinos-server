module.exports = {
  root: true,
  parser: "babel-eslint",
  parserOptions: {
    sourceType: "module"
  },
  extends: "prettier",
  rules: {
    "no-debugger": process.env.NODE_ENV === "production" ? 2 : 0,
    "comma-dangle": ["error", "always-multiline"]
  }
};
