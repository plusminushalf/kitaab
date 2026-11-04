// Dev only. macOS takes the menu-bar name and the dock icon from the app
// bundle, so stock Electron shows "Electron". This makes a private copy of
// Electron.app named Kitab with our icon, and `pnpm dev` runs that copy
// (electron-vite reads ELECTRON_EXEC_PATH). The copy is a clone (cp -c), so it costs
// almost no disk, and node_modules/electron itself is never touched: pnpm
// hard-links it from the shared store.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const NAME = "Kitab"
const root = join(import.meta.dirname, "..")
const icon = join(root, "resources/icon.icns")
const require = createRequire(import.meta.url)
const srcApp = join(dirname(require.resolve("electron")), "dist/Electron.app")
// Electron 45+ has no postinstall that downloads the binary; requiring the
// package downloads it if it is missing (e.g. after a fresh CI install).
require("electron")
const outDir = join(root, "node_modules/.kitab-electron")
const app = join(outDir, `${NAME}.app`)
const stampFile = join(outDir, "stamp")

const version = require("electron/package.json").version
const stamp = `${version} ${app} ${createHash("sha256").update(readFileSync(icon)).digest("hex")}`
if (existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) process.exit(0)

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync("cp", ["-cR", srcApp, app])

const plist = join(app, "Contents/Info.plist")
for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
  execFileSync("plutil", ["-replace", key, "-string", NAME, plist])
}
copyFileSync(icon, join(app, "Contents/Resources/electron.icns"))
// Editing Info.plist breaks the bundle's ad-hoc signature; sign the copy again.
execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "ignore" })

writeFileSync(stampFile, stamp)
console.log(`[dev-electron] ${NAME}.app ready (Electron ${version})`)
