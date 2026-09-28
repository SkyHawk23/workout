import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // Dummy values so modules that assert required secrets at import time
    // (api/_auth.js, api/_db.js, api/_anthropic.js — by design, so a real
    // deployment fails fast at cold start rather than on the first request)
    // load fine under test. Never real secrets.
    env: {
      JWT_SECRET: "test-secret-not-for-production",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
    },
  },
});
