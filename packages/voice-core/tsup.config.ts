import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig({
  entry: {
    index: "src/index.ts",
    headless: "src/headless/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // `./headless` must not pull in the WebRTC and WebSocket code.
  splitting: true,
  define: { __SDK_VERSION__: JSON.stringify(version) },
});
