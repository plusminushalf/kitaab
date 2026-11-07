// The app updater's state as the renderer sees it, plus the actions and toasts that go
// with it. The main process does the work (src/main/updater.ts); this only mirrors it.
import { useSyncExternalStore } from "react"
import { toast } from "sonner"
import type { UpdateState } from "../../../shared/bridge"

let current: UpdateState | null = null
const listeners = new Set<() => void>()
let started = false

function apply(next: UpdateState) {
  const prev = current
  current = next
  for (const l of listeners) l()
  announce(prev, next)
}

function start() {
  if (started) return
  started = true
  window.hermes.updates.onState(apply)
  void window.hermes.updates.get().then(apply)
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Mount once near the root so update toasts show even when no update UI is on screen. */
export function useUpdateState(): UpdateState | null {
  start()
  return useSyncExternalStore(subscribe, () => current)
}

export type UpdateAction = "download" | "install" | "none"

/** What clicking the update button does now. */
export function updateAction(s: UpdateState | null): UpdateAction {
  if (!s) return "none"
  if (s.downloadedVersion && (s.status === "downloaded" || s.errorContext === "install")) return "install"
  if (s.status === "available") return "download"
  return "none"
}

export function canCheck(s: UpdateState | null): boolean {
  return !!s && s.status !== "disabled" && s.status !== "checking" && s.status !== "downloading"
}

/** The version the button is about: the staged one when installing, else the newest offered. */
export function targetVersion(s: UpdateState): string | null {
  return updateAction(s) === "install" ? s.downloadedVersion : (s.availableVersion ?? s.downloadedVersion)
}

/** One line for tooltips and the settings row. */
export function describeUpdate(s: UpdateState): string {
  const v = targetVersion(s)
  if (s.notAppliedVersion && v === s.notAppliedVersion && s.status !== "downloading") {
    return `Update ${v} didn't install. Click to try again.`
  }
  switch (s.status) {
    case "disabled":
      return s.message ?? "Updates aren't available in this build."
    case "checking":
      return "Checking for updates…"
    case "available":
      return s.errorContext === "download" && s.message
        ? `Download of ${v} failed: ${s.message}`
        : `Kitaab ${v} is available.`
    case "downloading":
      return `Downloading ${v}${s.downloadPercent != null ? ` (${Math.floor(s.downloadPercent)}%)` : ""}…`
    case "downloaded":
      return s.errorContext === "install" && s.message
        ? `Couldn't install ${v}: ${s.message}`
        : `Kitaab ${v} is ready. Restart to update.`
    case "error":
      return s.message ?? "Couldn't check for updates."
    case "up-to-date":
      return `Kitaab ${s.currentVersion} is the latest version.`
    default:
      return `Kitaab ${s.currentVersion}`
  }
}

export const releaseUrl = (version: string) => `https://github.com/plusminushalf/kitaab/releases/tag/v${version}`

export async function downloadUpdate() {
  const s = await window.hermes.updates.download()
  if (s.errorContext === "download" && s.message) toast.error("Couldn't download the update", { description: s.message })
}

export async function installUpdate() {
  await window.hermes.updates.install()
}

/** The update button's click: download, or restart into the downloaded version. */
export function runUpdateAction(s: UpdateState | null) {
  const action = updateAction(s)
  if (action === "download") void downloadUpdate()
  else if (action === "install") void installUpdate()
}

/** "Check for Updates…" from the menu or settings: always says what it found. */
export async function checkForUpdatesLoudly() {
  const id = toast.loading("Checking for updates…")
  const s = await window.hermes.updates.check()
  toast.dismiss(id)
  if (s.status === "disabled") toast.info("Updates are off", { description: s.message ?? undefined })
  else if (s.status === "error") toast.error("Couldn't check for updates", { description: s.message ?? undefined })
  else if (s.status === "up-to-date") toast.success("You're up to date", { description: `Kitaab ${s.currentVersion} is the latest version.` })
  else if (s.status === "available")
    toast(`Kitaab ${s.availableVersion} is available`, {
      description: `You have ${s.currentVersion}.`,
      action: { label: "Download", onClick: () => void downloadUpdate() },
    })
  else if (s.status === "downloaded")
    toast(`Kitaab ${s.downloadedVersion} is ready`, {
      action: { label: "Restart", onClick: () => void installUpdate() },
    })
}

/** Toasts for moments the user didn't ask about: a finished download, a finished or failed install. */
function announce(prev: UpdateState | null, next: UpdateState) {
  if (prev?.status === "downloading" && next.status === "downloaded" && next.downloadedVersion) {
    const v = next.downloadedVersion
    toast.success(`Kitaab ${v} downloaded`, {
      description: "Restart to install it. The update button in the sidebar does it too.",
      action: { label: "Restart", onClick: () => void installUpdate() },
      duration: 15_000,
    })
  }
  if (next.justUpdatedFrom && prev?.justUpdatedFrom !== next.justUpdatedFrom) {
    const v = next.currentVersion
    toast.success(`Updated to Kitaab ${v}`, {
      action: { label: "What's new", onClick: () => void window.open(releaseUrl(v)) },
      duration: 10_000,
    })
    window.hermes.updates.acknowledge()
  }
  if (next.notAppliedVersion && prev?.notAppliedVersion !== next.notAppliedVersion) {
    toast.error(`Kitaab ${next.notAppliedVersion} didn't install`, {
      description: `You're still on ${next.currentVersion}. Try again from the sidebar, or reinstall with install.sh.`,
      duration: 15_000,
    })
  }
}
