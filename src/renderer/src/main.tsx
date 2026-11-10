import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/globals.css"
// Hooks the shared core up to Electron before anything uses it.
import "./lib/platform"
// Applies the saved theme before the first paint.
import "./lib/appearance/store"
import { App } from "./App"
import { store } from "./lib/store"
import { backend, gw } from "@kitab/core/backend"
import { fileUrl } from "@kitab/core/server-files"
import { startAnalytics } from "./lib/analytics"

void startAnalytics().catch(() => {})

// Dev only: a handle for tooling (see remote-debugging-port in the main process).
if (import.meta.env.DEV) Object.assign(window, { __dev: { store, backend, fileUrl, gw } })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
