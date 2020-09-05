module.exports = {
  apps: [
    {
      name: "coinos",
      watch: ["src"],
      script: "index.js",
      env: {
        COMMON_VARIABLE: "true",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
