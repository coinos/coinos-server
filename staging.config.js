module.exports = {
  apps: [
    {
      name: "coinosstaging",
      watch: ["src"],
      script: "index.js",
      env: {
        COMMON_VARIABLE: "true",
      },
      env_development: {
        NODE_ENV: "development",
      },
    },
  ],
};
