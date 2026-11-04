// Wraps dist/Kitab.app in a drag-to-Applications disk image:
// dist/Kitab-<version>-<arch>.dmg. Run `pnpm package` first (`pnpm dmg` does both).
//
// With APPLE_SIGNING_IDENTITY set, the image is signed too. With APPLE_ID,
// APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID also set, it is notarized by
// Apple and the ticket stapled, so it opens on any Mac without a Gatekeeper prompt.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const NAME = "Kitab"
const root = join(import.meta.dirname, "..")
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const app = join(root, "dist", `${NAME}.app`)
const dmg = join(root, "dist", `${NAME}-${pkg.version}-${process.arch}.dmg`)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" })

if (!existsSync(app)) {
  console.error("Run `pnpm package` first.")
  process.exit(1)
}

// The window shows the app next to a link to /Applications.
const stage = mkdtempSync(join(tmpdir(), "kitab-dmg-"))
run("cp", ["-R", app, join(stage, `${NAME}.app`)])
symlinkSync("/Applications", join(stage, "Applications"))

rmSync(dmg, { force: true })
// hdiutil sometimes fails with "Resource busy" on CI runners; a retry clears it.
for (let attempt = 1; ; attempt++) {
  try {
    run("hdiutil", ["create", "-volname", NAME, "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg])
    break
  } catch (err) {
    if (attempt === 3) throw err
    console.warn(`[dmg] hdiutil failed, retrying (${attempt}/3)`)
    execFileSync("sleep", ["5"])
  }
}
rmSync(stage, { recursive: true, force: true })

const identity = process.env.APPLE_SIGNING_IDENTITY
if (identity) {
  run("codesign", ["--force", "--timestamp", "--sign", identity, dmg])
}

const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
if (identity && APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
  console.log("[dmg] notarizing (this usually takes a few minutes)")
  run("xcrun", [
    "notarytool", "submit", dmg,
    "--apple-id", APPLE_ID, "--password", APPLE_APP_SPECIFIC_PASSWORD, "--team-id", APPLE_TEAM_ID,
    "--wait",
  ])
  run("xcrun", ["stapler", "staple", dmg])
}

console.log(`[dmg] ${dmg}`)
