import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.tsx" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react", "@uraiai/voice-core"],
  // The "use client" banner has to land on every emitted file; with
  // splitting on it only reaches the entry chunks and RSC breaks.
  splitting: false,
  banner: { js: '"use client";' },
});
