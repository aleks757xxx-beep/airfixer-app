import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Интерфейс собирается в dist/ и открывается на app.airfixer.ge
export default defineConfig({
  root: "web",
  base: "/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true, assetsInlineLimit: 0 },
});
