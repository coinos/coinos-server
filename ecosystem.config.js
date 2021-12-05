module.exports = {
  apps: [
    {
      name: "coinos",
      watch: ["src"],
      script: "index.js",
      env: {
        COMMON_VARIABLE: "true",
        DEBUG: "lnurl*",
      },
      env_production: {
        NODE_ENV: "production",
        DEBUG: "lnurl*",
      },
    },
  ],
};
