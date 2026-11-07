import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Интерфейс собирается в dist/next и открывается по адресу /next/ (пока старая версия живёт на «/»).
export default defineConfig({
  root: "web",
  base: "/next/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/next", emptyOutDir: true, assetsInlineLimit: 0 },
});
