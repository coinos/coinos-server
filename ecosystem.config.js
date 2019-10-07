module.exports = {
  apps: [
    {
      name: "coinos",
      script: "index.js",
      watch: ["./"],
      interpreter: "node",
      env: {
        COMMON_VARIABLE: "true",
        NODE_OPTIONS: "--require ./.pnp.js"
      },
      env_production: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--require ./.pnp.js"
      }
    }
  ]
};
