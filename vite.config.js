import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built files work when served from any subpath -
// handy since you don't know the final hosting URL yet.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: true, // reachable from your phone on the same network while testing in Termux
  },
});
