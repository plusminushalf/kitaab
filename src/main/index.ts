import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron"
import { basename, join } from "node:path"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { installMenu } from "./menu"
import { currentBindings, loadShortcutOverrides, saveShortcutOverrides } from "./shortcuts"
import type { ShortcutOverrides } from "../shared/shortcuts"
import { isConfigured, loadSettings, saveSettings, type Settings } from "./settings"
import type { ConnectionResult, FileText, SetupTarget } from "../shared/bridge"
import { restoreWindowState, trackWindowState } from "./window-state"
import { Tunnel } from "./tunnel"
import { AuthError, authedFetch, authRequired, forgetAuthMode, signIn, signOut, wsTicket } from "./auth"
import { connectedHosts, ensureRemoteBackend, stopRemoteBackend } from "./remote"
import { checkTarget, plainConnectError, sshConfigHosts } from "./setup"
import { installThemeIpc } from "./themes"
import { acknowledgeUpdate, checkForUpdates, downloadUpdate, getUpdateState, installUpdate, startUpdater } from "./updater"

// macOS only. Nothing here tries to be cross-platform.

let mainWindow: BrowserWindow | null = null
const tunnel = new Tunnel()

// The official Hermes desktop app owns ~/Library/Application Support/Hermes.
// Keep our own folder so we never share its settings or its single-instance lock.
// The folder keeps its pre-Kitaab name so existing settings survive the rename.
app.setPath("userData", join(app.getPath("appData"), "hermes-desktop"))
// Dev only: a separate profile, to try the first-run screen without touching your own.
if (!app.isPackaged && process.env.KITAAB_USER_DATA) app.setPath("userData", process.env.KITAAB_USER_DATA)

if (!app.requestSingleInstanceLock()) app.quit()

// Dev only: lets tooling drive and inspect the renderer (Chrome DevTools Protocol on 127.0.0.1).
if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9339")

function createWindow(): BrowserWindow {
  const bounds = restoreWindowState()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: "Kitaab",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      scrollBounce: true,
    },
  })

  trackWindowState(win)
  win.once("ready-to-show", () => win.show())

  // Links open in the default browser, never inside the app.
  // kitaab:// (and older kitab://) links are followed by the renderer itself; never hand them to macOS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^kitaa?b:/i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (!/^kitaa?b:/i.test(url)) void shell.openExternal(url)
    }
  })

  // Three-finger swipe (when macOS "Swipe between pages" uses three fingers).
  win.on("swipe", (_e, direction) => {
    if (direction === "right") win.webContents.send("menu", "back")
    if (direction === "left") win.webContents.send("menu", "forward")
  })

  const fullscreen = (value: boolean) => win.webContents.send("window:fullscreen", value)
  win.on("enter-full-screen", () => fullscreen(true))
  win.on("leave-full-screen", () => fullscreen(false))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"))
  }
  return win
}

function send(channel: string, ...args: unknown[]) {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  win?.webContents.send(channel, ...args)
}

ipcMain.handle("settings:get", () => loadSettings())
ipcMain.handle("settings:set", async (_e, next: Settings) => {
  saveSettings(next)
  current = null
  return loadSettings()
})

// First run: no connection is set up until the person picks one and it passes the check.
ipcMain.handle("setup:needed", () => !isConfigured())
ipcMain.handle("setup:sshHosts", () => [...new Set([...connectedHosts(), ...sshConfigHosts()])])
ipcMain.handle("setup:check", (e, t: SetupTarget) => {
  current = null
  return checkTarget(
    t,
    (steps) => e.sender.send("setup:progress", steps),
    async (host, port) => `http://127.0.0.1:${await tunnel.open(host, port)}`,
  )
})

// Two ways to reach Hermes:
//  - SSH host (default): our own private `hermes serve` on that host, reached
//    through a tunnel, authenticated with the session token we minted.
//  - URL: an existing dashboard; if it requires login we sign in via the browser.
type Target =
  | { kind: "ssh"; host: string; label: string; baseUrl: string; token: string }
  | { kind: "url"; server: string; label: string; baseUrl: string }

let current: Target | null = null

let resolving: Promise<Target> | null = null
function resolveTarget(): Promise<Target> {
  resolving ??= resolveTargetOnce().finally(() => (resolving = null))
  return resolving
}

async function resolveTargetOnce(): Promise<Target> {
  const s = loadSettings()
  if (s.sshHost) {
    const host = s.sshHost
    console.log("[connect] ensuring backend on", host)
    const backend = await ensureRemoteBackend(host, async (remotePort) => `http://127.0.0.1:${await tunnel.open(host, remotePort)}`)
    console.log("[connect] backend pid", backend.pid, "remote port", backend.port)
    current = { kind: "ssh", host, label: host, baseUrl: backend.baseUrl, token: backend.token }
  } else {
    const url = s.baseUrl.replace(/\/+$/, "")
    current = { kind: "url", server: url, label: new URL(url).host, baseUrl: url }
  }
  return current
}

const target = async () => current ?? resolveTarget()

// Everything the renderer needs to open the gateway socket.
ipcMain.handle("connection:open", async (): Promise<ConnectionResult> => {
  try {
    const t = await resolveTarget()
    const status = (await (await fetch(`${t.baseUrl}/api/status`)).json()) as { version?: string }
    const ws = new URL("/api/ws", t.baseUrl.replace(/^http/, "ws"))
    if (t.kind === "ssh") {
      ws.searchParams.set("token", t.token)
    } else {
      forgetAuthMode(t.baseUrl)
      if (await authRequired(t.baseUrl)) ws.searchParams.set("ticket", await wsTicket(t.server, t.baseUrl))
    }
    console.log("[connect] ready:", t.baseUrl)
    const files = t.kind === "ssh" ? { base: t.baseUrl, token: t.token } : undefined
    return { ok: true, wsUrl: ws.toString(), label: t.label, version: status.version, files }
  } catch (e) {
    console.error("[connection]", e)
    current = null
    const raw = e instanceof Error ? e.message : String(e)
    const host = loadSettings().sshHost
    return {
      ok: false,
      needsSignIn: e instanceof AuthError && e.needsSignIn,
      // Over SSH, say what's wrong in plain words ("SSH key not loaded") rather than ssh's own.
      message: host ? await plainConnectError(host, raw) : raw,
    }
  }
})

ipcMain.handle("auth:signIn", async () => {
  const t = await target()
  if (t.kind === "url") await signIn(t.server, t.baseUrl)
})
ipcMain.handle("auth:signOut", async () => {
  const t = await target()
  if (t.kind === "url") signOut(t.server)
})

// Stops our private backend on the SSH host; the next connect starts a fresh one.
ipcMain.handle("server:restart", async () => {
  const s = loadSettings()
  tunnel.close()
  current = null
  if (s.sshHost) await stopRemoteBackend(s.sshHost)
})

// Authenticated REST reads (cron jobs, runs, session lists) go through here.
ipcMain.handle("api:get", async (_e, path: string) => {
  if (typeof path !== "string" || !path.startsWith("/api/")) throw new Error("Only /api/ paths")
  const t = await target()
  if (t.kind === "ssh") {
    const res = await fetch(`${t.baseUrl}${path}`, { headers: { "x-hermes-session-token": t.token } })
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return res.json()
  }
  return (await authedFetch(t.server, t.baseUrl, path)).json()
})

// Authenticated REST writes, kept to an allowlist: config saves, a profile's skills,
// installing Kitaab's own Hermes plugin (packages/core/src/kitaab-plugin.ts), and making a
// new project's folder (packages/core/src/projects.ts; mkdir only ever adds a directory).
const WRITABLE: Record<"PUT" | "POST", RegExp> = {
  PUT: /^\/api\/(config|skills\/toggle|skills\/content)(\?|$)/,
  POST: /^\/api\/(skills|files\/upload|files\/mkdir|dashboard\/agent-plugins\/activate)(\?|$)/,
}
/** File uploads may only write the Kitaab plugin's own files. */
const PLUGIN_FILE = /^\/[^\0]*\/plugins\/kitaab\/(plugin\.yaml|__init__\.py)$/
async function write(method: "PUT" | "POST", path: string, body: unknown) {
  if (typeof path !== "string" || !WRITABLE[method].test(path)) throw new Error(`Writing ${path} isn't allowed`)
  if (path.startsWith("/api/files/upload")) {
    const file = (body as { path?: unknown } | null)?.path
    if (typeof file !== "string" || !PLUGIN_FILE.test(file) || file.includes("/../")) {
      throw new Error("Uploading that file isn't allowed")
    }
  }
  const t = await target()
  const init: RequestInit = { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  if (t.kind !== "ssh") return (await authedFetch(t.server, t.baseUrl, path, init)).json()
  const res = await fetch(`${t.baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), "x-hermes-session-token": t.token },
  })
  if (!res.ok) throw new Error((await errorDetail(res)) ?? `${method} ${path} → ${res.status}`)
  return res.json()
}
/** FastAPI puts the reason in `detail`; surface it (a skill name already taken, bad frontmatter…). */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const d = ((await res.json()) as { detail?: unknown }).detail
    return typeof d === "string" ? d : undefined
  } catch {
    return undefined
  }
}
ipcMain.handle("api:put", (_e, path: string, body: unknown) => write("PUT", path, body))
ipcMain.handle("api:post", (_e, path: string, body: unknown) => write("POST", path, body))

async function download(path: string, name: string): Promise<Buffer> {
  const t = await target()
  const url = `/api/files/download?path=${encodeURIComponent(path)}`
  const res =
    t.kind === "ssh"
      ? await fetch(`${t.baseUrl}${url}`, { headers: { "x-hermes-session-token": t.token } })
      : await authedFetch(t.server, t.baseUrl, url)
  if (!res.ok) throw new Error(`Couldn't download ${name} (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

// Quick Look for a file that lives on the server: download into a cache, then preview natively.
ipcMain.handle("files:quickLook", async (e, path: string, name: string) => {
  const data = await download(path, name)
  const dir = join(app.getPath("userData"), "files", createHash("sha1").update(path).digest("hex").slice(0, 12))
  mkdirSync(dir, { recursive: true })
  const safeName = basename(name).replace(/[/\\]/g, "_") || "file"
  const local = join(dir, safeName)
  writeFileSync(local, data)
  const win = BrowserWindow.fromWebContents(e.sender)
  win?.previewFile(local, safeName)
})

// Text of a server file for the side panel. Binary files come back as text: null.
const READ_LIMIT = 5 * 1024 * 1024
ipcMain.handle("files:read", async (_e, path: string): Promise<FileText> => {
  const data = await download(path, basename(path))
  const head = data.subarray(0, 8192)
  if (head.includes(0)) return { text: null, size: data.length, truncated: false }
  const truncated = data.length > READ_LIMIT
  return { text: data.subarray(0, READ_LIMIT).toString("utf8"), size: data.length, truncated }
})

ipcMain.handle("connection:close", () => tunnel.close())

ipcMain.handle("window:isFullscreen", (e) => BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false)
ipcMain.on("app:badge", (_e, count: number) => app.dock?.setBadge(count > 0 ? String(count) : ""))
ipcMain.on("app:bounce", () => app.dock?.bounce("informational"))

installThemeIpc()

ipcMain.handle("update:get", () => getUpdateState())
ipcMain.handle("update:check", () => checkForUpdates())
ipcMain.handle("update:download", () => downloadUpdate())
ipcMain.handle("update:install", () => installUpdate())
ipcMain.on("update:acknowledge", () => acknowledgeUpdate())

// Settings → Shortcuts: the person's changes, applied to the menu bar as they're saved.
ipcMain.handle("shortcuts:get", () => loadShortcutOverrides())
ipcMain.handle("shortcuts:set", (_e, next: ShortcutOverrides) => {
  const saved = saveShortcutOverrides(next)
  installMenu(send, currentBindings())
  return saved
})
ipcMain.on("shortcuts:pause", (_e, paused: boolean) => installMenu(send, currentBindings(), paused))

app.whenReady().then(() => {
  nativeTheme.themeSource = "system"
  installMenu(send, currentBindings())
  mainWindow = createWindow()
  startUpdater()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    else mainWindow?.show()
  })
})

app.on("second-instance", () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

// Mac convention: closing the window keeps the app alive in the dock.
app.on("window-all-closed", () => {})
app.on("before-quit", () => tunnel.close())
