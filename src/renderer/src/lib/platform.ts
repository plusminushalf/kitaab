import { toast } from "sonner"
import { setPlatform } from "@kitab/core/platform"

// The Mac side of the shared core: Electron's bridge for networking, sonner for notices,
// the Dock for attention, localStorage for this device's own settings.

setPlatform({
  kind: "mac",
  connect: () => window.hermes.connection.open(),
  http: {
    get: (path) => window.hermes.api.get(path),
    put: (path, body) => window.hermes.api.put(path, body),
    post: (path, body) => window.hermes.api.post(path, body),
  },
  notify(kind, message, options) {
    const opts = options ? { id: options.id, action: options.action } : undefined
    if (kind === "info") toast(message, opts)
    else toast[kind](message, opts)
  },
  dismiss: (id) => void toast.dismiss(id),
  confirm: async (message) => window.confirm(message),
  attention() {
    if (!document.hasFocus()) window.hermes.dock.bounce()
  },
  storage: {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {}
    },
  },
  async base64(url) {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    let bin = ""
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  },
})
