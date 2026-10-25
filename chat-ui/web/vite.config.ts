import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The built files go to ../static, where server.py serves them. In development, `npm run dev` proxies the API
// to a server started with `python server.py --demo` (or without --demo) on port 8000.
export default defineConfig({
  plugins: [react()],
  base: "/static/",
  build: { outDir: "../static", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
