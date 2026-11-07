// Theme helpers for Settings → Appearance: Open VSX search and install, theme file
// export, and the list of installed font families.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, normalize } from "node:path"
import { promisify } from "node:util"
import { parseJsonc } from "../shared/jsonc"
import type { ExtensionTheme, ThemeExtension, ThemeSearchSort } from "../shared/bridge"

const run = promisify(execFile)
const OPEN_VSX = "https://open-vsx.org/api"
const MAX_VSIX = 20 * 1024 * 1024
const UA = { "user-agent": `Kitaab/${app.getVersion()}` }

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`Open VSX answered ${res.status}`)
  return (await res.json()) as T
}

type SearchResult = {
  extensions?: {
    namespace: string
    name: string
    version?: string
    displayName?: string
    description?: string
    downloadCount?: number
    averageRating?: number
    files?: { icon?: string }
  }[]
}

async function search(query: string, sort: ThemeSearchSort): Promise<ThemeExtension[]> {
  const params = new URLSearchParams({ category: "Themes", size: "40", sortBy: sort, sortOrder: "desc" })
  if (query.trim()) params.set("query", query.trim())
  const data = await json<SearchResult>(`${OPEN_VSX}/-/search?${params}`)
  return (data.extensions ?? []).map((e) => ({
    namespace: e.namespace,
    name: e.name,
    displayName: e.displayName || e.name,
    description: e.description,
    version: e.version,
    downloadCount: e.downloadCount,
    averageRating: e.averageRating,
    iconUrl: e.files?.icon,
  }))
}

/** Reads one file out of the .vsix (a zip) with macOS's unzip. */
async function readEntry(vsix: string, entry: string): Promise<string> {
  const { stdout } = await run("/usr/bin/unzip", ["-p", vsix, entry], { maxBuffer: MAX_VSIX })
  return stdout
}

type Manifest = {
  displayName?: string
  name?: string
  contributes?: { themes?: { label?: string; uiTheme?: string; path?: string }[] }
}

async function install(namespace: string, name: string): Promise<{ displayName: string; themes: ExtensionTheme[] }> {
  if (!/^[\w.-]+$/.test(namespace) || !/^[\w.-]+$/.test(name)) throw new Error("That isn't an Open VSX extension.")
  const meta = await json<{ displayName?: string; files?: { download?: string } }>(
    `${OPEN_VSX}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  )
  const url = meta.files?.download
  if (!url || !url.startsWith("https://")) throw new Error("Open VSX has no download for that extension.")
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > MAX_VSIX) throw new Error("That extension is too large to be a theme.")

  const dir = mkdtempSync(join(tmpdir(), "kitab-theme-"))
  const vsix = join(dir, "theme.vsix")
  writeFileSync(vsix, data)
  try {
    const manifest = parseJsonc(await readEntry(vsix, "extension/package.json")) as Manifest
    const entries = manifest.contributes?.themes ?? []
    if (!entries.length) throw new Error("That extension has no color themes.")
    const themes: ExtensionTheme[] = []
    for (const t of entries) {
      if (!t.path) continue
      const path = normalize(join("extension", t.path))
      if (!path.startsWith("extension/")) continue
      try {
        themes.push({ label: t.label ?? t.path, uiTheme: t.uiTheme, json: await withIncludes(vsix, path) })
      } catch {
        // Skip themes we can't read; the rest still install.
      }
    }
    if (!themes.length) throw new Error("None of that extension's themes could be read.")
    return { displayName: meta.displayName || manifest.displayName || name, themes }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** VS Code themes can "include" a base theme; fold its colors in (base first). */
async function withIncludes(vsix: string, path: string, depth = 0): Promise<string> {
  const text = await readEntry(vsix, path)
  const theme = parseJsonc(text) as Record<string, unknown>
  if (typeof theme.include !== "string" || depth > 3) return text
  const basePath = normalize(join(dirname(path), theme.include))
  if (!basePath.startsWith("extension/")) return text
  const base = parseJsonc(await withIncludes(vsix, basePath, depth + 1)) as Record<string, unknown>
  const colors = { ...(base.colors as object), ...(theme.colors as object) }
  return JSON.stringify({ ...base, ...theme, colors, include: undefined })
}

let fontCache: { family: string; monospace: boolean }[] | null = null

async function fonts() {
  if (fontCache) return fontCache
  const script = `ObjC.import("AppKit");
var fams = ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies);
JSON.stringify(fams.filter(function (f) { return f.charAt(0) !== "."; }).map(function (f) {
  var font = $.NSFont.fontWithNameSize(f, 12);
  return { family: f, monospace: font.isNil() ? false : !!font.isFixedPitch };
}));`
  const { stdout } = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { maxBuffer: 4 * 1024 * 1024 })
  fontCache = JSON.parse(stdout)
  return fontCache!
}

export function installThemeIpc() {
  ipcMain.on("appearance:scheme", (_e, scheme: "system" | "light" | "dark") => {
    if (scheme === "system" || scheme === "light" || scheme === "dark") {
      nativeTheme.themeSource = scheme
    }
  })
  ipcMain.handle("themes:search", (_e, query: string, sort: ThemeSearchSort) => search(String(query ?? ""), sort))
  ipcMain.handle("themes:install", (_e, namespace: string, name: string) => install(namespace, name))
  ipcMain.handle("themes:export", async (e, fileName: string, contents: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { defaultPath: fileName, filters: [{ name: "Theme", extensions: ["json"] }] }
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return false
    writeFileSync(filePath, contents)
    return true
  })
  ipcMain.handle("fonts:list", () => fonts())
}
