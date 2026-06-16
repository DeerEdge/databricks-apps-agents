import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // React plugin transforms .tsx component tests (per-file env via the "@vitest-environment" pragma).
  plugins: [react()],
  test: { environment: "node" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
