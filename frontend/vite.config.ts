import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Tauri 2 + Vite：固定 5173 端口，供 tauri.conf.json devUrl 指。
// AntDV 4 全局注册（main.ts app.use(Antd)），无需按需 resolver。
export default defineConfig({
  plugins: [vue()],
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
    include: ["src/**/*.test.ts"],
  },
});