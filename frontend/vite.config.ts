import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.component.test.ts", "happy-dom"]],
    include: ["src/**/*.test.ts"],
  },
});