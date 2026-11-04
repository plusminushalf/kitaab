import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/globals.css"
// Applies the saved theme before the first paint.
import "./lib/appearance/store"
import { App } from "./App"
import { store } from "./lib/store"
import { backend, gw } from "./lib/backend"
import { fileUrl } from "./lib/server-files"

// Dev only: a handle for tooling (see remote-debugging-port in the main process).
if (import.meta.env.DEV) Object.assign(window, { __dev: { store, backend, fileUrl, gw } })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
