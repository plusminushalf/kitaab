// Builds a standalone Kitab.app from the electron-vite output: a copy of
// Electron.app renamed Kitab, with our icon and the built app in
// Contents/Resources/app. With --install it also replaces /Applications/Kitab.app.
// The app is ad-hoc signed, which is enough to run it on this Mac.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const NAME = "Kitab"
const BUNDLE_ID = "app.kitab.desktop"
const root = join(import.meta.dirname, "..")
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const srcApp = join(dirname(require.resolve("electron")), "dist/Electron.app")
// Electron 45+ has no postinstall that downloads the binary; requiring the
// package downloads it if it is missing (e.g. after a fresh CI install).
require("electron")
const outDir = join(root, "dist")
const app = join(outDir, `${NAME}.app`)

if (!existsSync(join(root, "out/main/index.js"))) {
  console.error("Run `pnpm build` first.")
  process.exit(1)
}

rmSync(app, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync("cp", ["-cR", srcApp, app])

const plist = join(app, "Contents/Info.plist")
const set = (key, value) => execFileSync("plutil", ["-replace", key, "-string", value, plist])
set("CFBundleName", NAME)
set("CFBundleDisplayName", NAME)
set("CFBundleIdentifier", BUNDLE_ID)
set("CFBundleShortVersionString", pkg.version)
set("CFBundleVersion", pkg.version)
copyFileSync(join(root, "resources/icon.icns"), join(app, "Contents/Resources/electron.icns"))
rmSync(join(app, "Contents/Resources/default_app.asar"), { force: true })

// The app itself: the built bundles plus a package.json Electron reads for its name and entry.
const res = join(app, "Contents/Resources/app")
mkdirSync(res, { recursive: true })
cpSync(join(root, "out"), join(res, "out"), { recursive: true })
writeFileSync(
  join(res, "package.json"),
  JSON.stringify({ name: pkg.name, productName: NAME, version: pkg.version, main: pkg.main, type: pkg.type }, null, 2),
)

// Editing the bundle breaks Electron's signature, so sign it again. With
// APPLE_SIGNING_IDENTITY set (a Developer ID Application identity in the keychain)
// it is signed for distribution: hardened runtime, secure timestamp, and the
// entitlements Electron needs. Otherwise it is signed ad hoc, for this Mac only.
const identity = process.env.APPLE_SIGNING_IDENTITY
if (identity) {
  execFileSync(
    "codesign",
    [
      "--force", "--deep", "--timestamp", "--options", "runtime",
      "--entitlements", join(root, "resources/entitlements.mac.plist"),
      "--sign", identity, app,
    ],
    { stdio: "inherit" },
  )
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
} else {
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "ignore" })
}
console.log(`[package] ${app}${identity ? " (Developer ID)" : " (ad hoc)"}`)

if (process.argv.includes("--install")) {
  const target = `/Applications/${NAME}.app`
  // Quit a running copy so it can be replaced.
  try {
    execFileSync("osascript", ["-e", `if application id "${BUNDLE_ID}" is running then tell application id "${BUNDLE_ID}" to quit`], { stdio: "ignore" })
  } catch {}
  rmSync(target, { recursive: true, force: true })
  execFileSync("cp", ["-cR", app, target])
  // Register with Launch Services so Spotlight and the Dock pick up the name and icon.
  execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target])
  console.log(`[package] installed ${target}`)
}
