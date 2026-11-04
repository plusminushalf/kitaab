import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The shared Hermes core (also used by the iPhone app), imported as @kitab/core/<module>.
const core = { "@kitab/core": resolve(import.meta.dirname, "packages/core/src") }

export default defineConfig({
  main: { resolve: { alias: core } },
  // Sandboxed windows can only load a CommonJS preload.
  preload: {
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    resolve: {
      alias: { "@": resolve(import.meta.dirname, "src/renderer/src"), ...core },
    },
    plugins: [react(), tailwindcss()],
  },
})
