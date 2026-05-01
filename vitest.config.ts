import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // SPEC-08: if native `worker_threads` integration tests are added and flake, try:
    // poolOptions: { threads: { singleThread: true } },
  },
});
