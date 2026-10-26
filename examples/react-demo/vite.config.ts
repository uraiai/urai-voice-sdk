import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The port must match the agent's allowed domains (`localhost:5180`).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
});
