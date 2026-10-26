import { defineConfig } from "vitest/config";

/**
 * One project per environment. The headless store and reducers are pure,
 * so they run under `node`; anything touching WebSocket, WebRTC or the
 * DOM gets jsdom (with the fakes from `@uraiai/voice-test-support`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core-headless",
          environment: "node",
          include: ["packages/voice-core/tests/headless/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "core",
          environment: "jsdom",
          include: ["packages/voice-core/tests/*.test.ts"],
        },
      },
      {
        test: {
          name: "react",
          environment: "jsdom",
          include: ["packages/voice-react/tests/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
