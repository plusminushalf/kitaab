// Kitaab's app updater.
//
// The flow copies T3 Code's: check quietly after launch and every so often, offer the
// update in the sidebar, download it when asked (with progress), then "Restart to
// update" swaps the app and reopens it.
//
// The mechanism doesn't. T3 Code uses electron-updater, whose Mac half (Squirrel.Mac)
// only accepts an update signed by the same Apple Developer ID as the running app.
// Kitaab is ad-hoc signed, so it trusts what install.sh already trusts instead:
//
//   1. SHA256SUMS from the latest GitHub release, signed with Kitaab's release key
//      (an Ed25519 SSH key, pinned below and in release-key.pub). The file names the
//      DMG, and the DMG's name carries the version, so the version is signed too.
//   2. The DMG, which must match its signed SHA-256.
//   3. The app inside, which must have our bundle id, the signed version and an
//      intact code signature.
//
// Only then is it staged. Installing waits for this process to quit, moves the
// staged app over the running one (asking for an admin password only if the app's
// folder isn't writable), and opens it again. If the new version doesn't come up,
// the next launch says so.

import { app, BrowserWindow } from "electron"
import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream, existsSync, openSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { promisify } from "node:util"
import type { ReleaseNote, UpdateState } from "../shared/bridge"

const run = promisify(execFile)

const REPO = "plusminushalf/kitaab"
const PRINCIPAL = "kitab-release"
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIKSxxZ9QRwqldlKJi68n/FSXG32Hpy8JCzYGIDVPSGo"

// For testing against a local feed signed with a throwaway key. Both come from the
// environment the app was launched with, which only code already running as the
// user can set.
const FEED_OVERRIDE = process.env.KITAAB_UPDATE_FEED?.replace(/\/+$/, "")
const KEY_OVERRIDE = process.env.KITAAB_UPDATE_PUBLIC_KEY

const STARTUP_DELAY = 15_000
const POLL_INTERVAL = 30 * 60_000
const FETCH_TIMEOUT = 30_000

/** Kitaab-0.2.0-arm64.dmg (releases before the rename were Kitab-…). */
const DMG_NAME = /^Kitaa?b-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-([a-z0-9_]+)\.dmg$/

// ~/Library/Caches is on the same volume as /Applications, so installing is a rename, not a copy.
const cacheDir = () => join(app.getPath("home"), "Library/Caches/Kitaab-updates")
const stagedApp = () => join(cacheDir(), "staged", "Kitaab.app")
const stagedRecord = () => join(cacheDir(), "staged.json")
const installRecord = () => join(app.getPath("userData"), "update-install.json")

type Offer = { version: string; file: string; sha256: string }

let state: UpdateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  releaseNotes: [],
  notAppliedVersion: null,
  justUpdatedFrom: null,
}
let offer: Offer | null = null
let checking: Promise<UpdateState> | null = null
let downloading: Promise<UpdateState> | null = null

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update:state", state)
}

export const getUpdateState = () => state

// ── Versions ──────────────────────────────────────────────────────────────────

/** -1, 0 or 1. A prerelease (1.2.0-beta.1) sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2) as [string, string | undefined]
    return { nums: core.split(".").map((n) => Number(n) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, undefined, { numeric: true }) < 0 ? -1 : 1
}

// ── Where this app lives ─────────────────────────────────────────────────────

/** /Applications/Kitaab.app, from …/Kitaab.app/Contents/MacOS/Kitaab. */
function bundlePath(): string | null {
  const bundle = dirname(dirname(dirname(process.execPath)))
  return bundle.endsWith(".app") ? bundle : null
}

/** Why this copy can't update itself, or null when it can. */
function disabledReason(): string | null {
  if (!app.isPackaged) return "Updates are off when Kitaab runs from source."
  if (process.platform !== "darwin") return "Updates are for macOS only."
  const bundle = bundlePath()
  if (!bundle) return "Kitaab can't find its own app bundle."
  // macOS runs a quarantined app that was never moved from a read-only, randomized path.
  if (bundle.includes("/AppTranslocation/")) {
    return "Move Kitaab to your Applications folder to get updates."
  }
  if (bundle.startsWith("/Volumes/")) return "Kitaab is running from a disk image. Copy it to Applications to get updates."
  return null
}

async function plistValue(bundle: string, key: string): Promise<string> {
  const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", join(bundle, "Contents/Info.plist")])
  return stdout.trim()
}

// ── The signed feed ──────────────────────────────────────────────────────────

function feedUrl(file: string, version?: string): string {
  if (FEED_OVERRIDE) return `${FEED_OVERRIDE}/${file}`
  // Pin the download to the version that was checked, so a release published in
  // between can't swap the DMG under a manifest it doesn't match.
  return version
    ? `https://github.com/${REPO}/releases/download/v${version}/${file}`
    : `https://github.com/${REPO}/releases/latest/download/${file}`
}

async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`${new URL(url).pathname.split("/").pop()}: HTTP ${res.status}`)
  return res
}

/** Verifies the manifest's signature with ssh-keygen, as install.sh does. Throws if it doesn't verify. */
async function verifySignature(manifest: Buffer, signature: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "kitaab-verify-"))
  try {
    const signers = join(dir, "allowed_signers")
    const sig = join(dir, "SHA256SUMS.sig")
    await writeFile(signers, `${PRINCIPAL} ${KEY_OVERRIDE ?? PUBLIC_KEY}\n`)
    await writeFile(sig, signature)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "/usr/bin/ssh-keygen",
        ["-Y", "verify", "-f", signers, "-I", PRINCIPAL, "-n", PRINCIPAL, "-s", sig],
        { stdio: ["pipe", "ignore", "ignore"] },
      )
      child.on("error", reject)
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("The update isn't signed by Kitaab's release key.")),
      )
      child.stdin.end(manifest)
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** The newest DMG for this Mac's architecture listed in a verified SHA256SUMS. */
function pickOffer(manifest: string): Offer | null {
  let best: Offer | null = null
  for (const line of manifest.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim())
    const name = m && DMG_NAME.exec(m[2]!)
    if (!m || !name || name[2] !== process.arch) continue
    if (!best || compareVersions(name[1]!, best.version) > 0) best = { version: name[1]!, file: m[2]!, sha256: m[1]! }
  }
  return best
}

// ── Release notes (best effort, unsigned, display only) ──────────────────────

/** The CI's release body opens with install steps and checksums; keep only what changed. */
function cleanNotes(body: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{1,3}\s+(.*)$/.exec(line)
    if (heading) skipping = /^(install|sha-?256)\b/i.test(heading[1]!.trim())
    if (!skipping) out.push(line)
  }
  return out.join("\n").trim()
}

async function fetchReleaseNotes(upTo: string): Promise<ReleaseNote[]> {
  if (FEED_OVERRIDE) return []
  try {
    const res = await fetchOk(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Kitaab-updater" },
      signal: AbortSignal.timeout(10_000),
    })
    const releases = (await res.json()) as {
      tag_name: string
      body: string | null
      html_url: string
      published_at: string | null
      draft: boolean
      prerelease: boolean
    }[]
    return releases
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({
        version: r.tag_name.replace(/^v/, ""),
        publishedAt: r.published_at,
        url: r.html_url,
        body: cleanNotes(r.body ?? ""),
      }))
      .filter((r) => compareVersions(r.version, state.currentVersion) > 0 && compareVersions(r.version, upTo) <= 0)
      .sort((a, b) => compareVersions(b.version, a.version))
  } catch (e) {
    console.warn("[update] release notes:", e instanceof Error ? e.message : e)
    return []
  }
}

// ── Check ────────────────────────────────────────────────────────────────────

export function checkForUpdates(): Promise<UpdateState> {
  if (state.status === "disabled") return Promise.resolve(state)
  if (downloading) return downloading
  checking ??= checkOnce().finally(() => (checking = null))
  return checking
}

async function checkOnce(): Promise<UpdateState> {
  const hadDownload = state.downloadedVersion
  set({ status: "checking", message: null, errorContext: null })
  try {
    const [manifest, signature] = await Promise.all(
      ["SHA256SUMS", "SHA256SUMS.sig"].map(async (f) => Buffer.from(await (await fetchOk(feedUrl(f))).arrayBuffer())),
    )
    await verifySignature(manifest!, signature!)
    const found = pickOffer(manifest!.toString("utf8"))
    const checkedAt = Date.now()

    if (!found || compareVersions(found.version, state.currentVersion) <= 0) {
      offer = null
      set({ status: "up-to-date", availableVersion: null, downloadPercent: null, releaseNotes: [], checkedAt })
      return state
    }

    offer = found
    if (hadDownload === found.version) {
      set({ status: "downloaded", availableVersion: found.version, downloadPercent: 100, checkedAt })
    } else {
      set({ status: "available", availableVersion: found.version, downloadPercent: null, checkedAt })
    }
    if (state.releaseNotes[0]?.version !== found.version) {
      set({ releaseNotes: await fetchReleaseNotes(found.version) })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn("[update] check failed:", message)
    // A staged update is still good; a failed check shouldn't hide it.
    if (hadDownload) set({ status: "downloaded", checkedAt: Date.now() })
    else set({ status: "error", message: friendly(message), errorContext: "check", checkedAt: Date.now() })
  }
  return state
}

function friendly(message: string): string {
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|aborted|timeout/i.test(message)) {
    return "Couldn't reach GitHub to check for updates."
  }
  return message
}

// ── Download and stage ───────────────────────────────────────────────────────

export function downloadUpdate(): Promise<UpdateState> {
  if (!offer || state.status === "disabled") return Promise.resolve(state)
  downloading ??= downloadOnce(offer).finally(() => (downloading = null))
  return downloading
}

async function downloadOnce(target: Offer): Promise<UpdateState> {
  set({ status: "downloading", downloadPercent: 0, message: null, errorContext: null })
  const dir = cacheDir()
  const dmg = join(dir, target.file)
  const mount = join(dir, "mnt")
  let mounted = false
  try {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })

    // Stream to disk, hashing as it goes.
    const res = await fetchOk(feedUrl(target.file, target.version), { signal: AbortSignal.timeout(30 * 60_000) })
    if (!res.body) throw new Error("The download came back empty.")
    const total = Number(res.headers.get("content-length")) || 0
    const hash = createHash("sha256")
    let received = 0
    let lastSent = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk)
        received += chunk.length
        const pct = total ? Math.min(99, (received / total) * 100) : null
        if (pct !== null && pct - lastSent >= 1) {
          lastSent = pct
          set({ downloadPercent: pct })
        }
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), meter, createWriteStream(dmg))
    const actual = hash.digest("hex")
    if (actual !== target.sha256) {
      throw new Error(`The download doesn't match its signed checksum (expected ${target.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`)
    }

    // Copy the app out of the image into the staging folder.
    await mkdir(mount)
    await run("/usr/bin/hdiutil", ["attach", "-quiet", "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mount, dmg])
    mounted = true
    const inside = (await readdir(mount)).find((n) => n.endsWith(".app"))
    if (!inside) throw new Error("The disk image has no app in it.")
    await mkdir(dirname(stagedApp()), { recursive: true })
    await run("/usr/bin/ditto", [join(mount, inside), stagedApp()])
    await run("/usr/bin/hdiutil", ["detach", "-quiet", mount])
    mounted = false
    await rm(dmg, { force: true })

    await checkStagedApp(target.version)
    await writeFile(stagedRecord(), JSON.stringify({ version: target.version }))
    set({ status: "downloaded", downloadedVersion: target.version, downloadPercent: 100 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[update] download failed:", message)
    if (mounted) await run("/usr/bin/hdiutil", ["detach", "-quiet", "-force", mount]).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    set({
      status: state.availableVersion ? "available" : "error",
      downloadPercent: null,
      downloadedVersion: null,
      message: friendly(message),
      errorContext: "download",
    })
  }
  return state
}

/** The staged app must be ours, be the version the signed manifest named, and have an intact signature. */
async function checkStagedApp(version: string) {
  const staged = stagedApp()
  const ours = bundlePath()
  const wantId = ours ? await plistValue(ours, "CFBundleIdentifier") : "app.kitaab.desktop"
  const id = await plistValue(staged, "CFBundleIdentifier")
  if (id !== wantId) throw new Error(`The update is a different app (${id}).`)
  const v = await plistValue(staged, "CFBundleShortVersionString")
  if (v !== version) throw new Error(`The update says it is ${v}, not ${version}.`)
  try {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged])
  } catch {
    throw new Error("The update's code signature is broken.")
  }
  // Files we download aren't quarantined, but a stray flag would make macOS block the new app.
  await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged]).catch(() => {})
}

// ── Install ──────────────────────────────────────────────────────────────────

// Runs after Kitaab quits: wait for it to exit, swap the bundles (asking for an admin
// password only if a plain move isn't allowed), then open whichever app is in place.
const INSTALL_SCRIPT = String.raw`#!/bin/bash
set -u
mode="$1"; shift

swap() {
  local target="$1" staged="$2" backup="$3"
  rm -rf "$backup"
  mv "$target" "$backup" || return 1
  if ! mv "$staged" "$target"; then
    mv "$backup" "$target"
    return 1
  fi
  rm -rf "$backup"
}

if [ "$mode" = swap ]; then
  swap "$@"
  exit $?
fi

pid="$1" target="$2" staged="$3" backup="$4"
for _ in $(seq 1 600); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$pid" 2>/dev/null; then
  echo "Kitaab didn't quit; not installing."
  exit 1
fi

if ! swap "$target" "$staged" "$backup" 2>/dev/null; then
  echo "A plain move failed; asking for an administrator password."
  /usr/bin/osascript \
    -e 'on run argv' \
    -e 'do shell script "/bin/bash " & quoted form of item 1 of argv & " swap " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv & " " & quoted form of item 4 of argv with prompt "Kitaab wants to install an update." with administrator privileges' \
    -e 'end run' \
    "$0" "$target" "$staged" "$backup" || echo "Install cancelled or failed."
fi

/usr/bin/xattr -dr com.apple.quarantine "$target" 2>/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$target" 2>/dev/null
/usr/bin/open "$target"
`

let installing = false

// The Restart click that calls this is the confirmation; asking again here meant confirming twice.
export async function installUpdate(): Promise<boolean> {
  const version = state.downloadedVersion
  const target = bundlePath()
  if (installing || !version || !target || state.status === "disabled") return false
  if (!existsSync(stagedApp())) {
    set({ status: state.availableVersion ? "available" : "up-to-date", downloadedVersion: null, downloadPercent: null })
    return false
  }

  installing = true
  try {
    const dir = cacheDir()
    const script = join(dir, "install.sh")
    await writeFile(script, INSTALL_SCRIPT, { mode: 0o755 })
    await writeFile(installRecord(), JSON.stringify({ from: state.currentVersion, to: version }))
    const log = join(dir, "install.log")
    const out = openSync(log, "w")
    const child = spawn(
      "/bin/bash",
      [script, "wait", String(process.pid), target, stagedApp(), join(dir, "previous.app")],
      { detached: true, stdio: ["ignore", out, out] },
    )
    child.unref()
    console.log("[update] installing", version, "over", target)
    setImmediate(() => app.quit())
    return true
  } catch (e) {
    installing = false
    const message = e instanceof Error ? e.message : String(e)
    set({ status: "downloaded", message, errorContext: "install" })
    return false
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

/** Reads what the last install left behind: a success to announce, or an update that didn't take. */
async function reconcileLastInstall() {
  const record = installRecord()
  if (!existsSync(record)) return
  try {
    const { from, to } = JSON.parse(readFileSync(record, "utf8")) as { from: string; to: string }
    if (state.currentVersion === to) {
      set({ justUpdatedFrom: from })
      await rm(cacheDir(), { recursive: true, force: true })
    } else if (state.currentVersion === from) {
      set({ notAppliedVersion: to })
    }
  } catch {}
  await rm(record, { force: true })
}

/** A download from an earlier session that's still staged and still newer than this app. */
async function restoreStaged() {
  try {
    const { version } = JSON.parse(readFileSync(stagedRecord(), "utf8")) as { version: string }
    if (compareVersions(version, state.currentVersion) > 0 && existsSync(stagedApp())) {
      await checkStagedApp(version)
      set({ downloadedVersion: version, availableVersion: version, status: "downloaded", downloadPercent: 100 })
      offer = null
      return
    }
  } catch {}
  await rm(cacheDir(), { recursive: true, force: true }).catch(() => {})
}

export function startUpdater() {
  const reason = disabledReason()
  if (reason) {
    set({ status: "disabled", message: reason })
    return
  }
  void (async () => {
    await reconcileLastInstall()
    await restoreStaged()
  })()
  setTimeout(() => void checkForUpdates(), STARTUP_DELAY)
  setInterval(() => {
    if (state.status !== "downloading") void checkForUpdates()
  }, POLL_INTERVAL)
}

export function acknowledgeUpdate() {
  if (state.justUpdatedFrom) set({ justUpdatedFrom: null })
}
