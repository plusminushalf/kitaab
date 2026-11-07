import { Alert, AppState } from "react-native"
import * as Haptics from "expo-haptics"
import { File } from "expo-file-system"
import { getRandomBytes } from "expo-crypto"
import { setPlatform, type ConnectionResult } from "@kitab/core/platform"
import { ensureBackend, stopScript, type SshRunner } from "@kitab/core/remote"
import Ssh from "../../modules/kitab-ssh/src/KitabSshModule"
import { kv } from "./kv"
import { ownershipId, serverSettings } from "./settings"
import { dismissToast, showToast } from "./toast"

// The iPhone side of the shared core. Same job as the Mac's main process: reach the Hermes
// host over SSH (in-app, see modules/kitab-ssh), find or start the shared Kitaab backend,
// tunnel to it, and make authenticated REST calls with its session token.

let current: { baseUrl: string; token: string } | null = null

const runner: SshRunner = {
  async exec(script, timeoutMs = 30_000) {
    const r = await Ssh.exec(script, timeoutMs)
    if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`)
    return r.stdout
  },
  forward: async (remotePort) => `http://127.0.0.1:${await Ssh.forward(remotePort)}`,
}

/** Opens the SSH connection (pinning the host key the first time). */
export async function openSsh() {
  const s = serverSettings.get()
  const r = await Ssh.connect(s.host.trim(), s.port || 22, s.user.trim(), s.hostKey ?? null)
  if (!s.hostKey && r.hostKey) serverSettings.set({ hostKey: r.hostKey, hostFingerprint: r.fingerprint })
  return r
}

async function connect(): Promise<ConnectionResult> {
  if (!serverSettings.configured()) {
    return { ok: false, needsSignIn: false, message: "Add your Hermes host in Settings" }
  }
  try {
    await openSsh()
    const s = serverSettings.get()
    const b = await ensureBackend(runner, { ownershipId: ownershipId(s.host), random: getRandomBytes })
    current = { baseUrl: b.baseUrl, token: b.token }
    const status = (await (await fetch(`${b.baseUrl}/api/status`)).json()) as { version?: string }
    const ws = `${b.baseUrl.replace(/^http/, "ws")}/api/ws?token=${encodeURIComponent(b.token)}`
    return { ok: true, wsUrl: ws, label: s.host, version: status.version, files: { base: b.baseUrl, token: b.token } }
  } catch (e) {
    current = null
    return { ok: false, needsSignIn: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** Stops the shared Kitaab backend on the host; the next connect starts a fresh one. */
export async function restartServer() {
  await openSsh()
  await runner.exec(stopScript())
  current = null
  await Ssh.disconnect()
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("Only /api/ paths")
  if (!current) throw new Error("Not connected to Hermes")
  const res = await fetch(`${current.baseUrl}${path}`, {
    method,
    headers: {
      "x-hermes-session-token": current.token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: any) => (typeof b?.detail === "string" ? b.detail : undefined))
      .catch(() => undefined)
    throw new Error(detail ?? `${method} ${path} → ${res.status}`)
  }
  return (await res.json()) as T
}

setPlatform({
  kind: "iphone",
  connect,
  http: {
    get: (path) => request("GET", path),
    put: (path, body) => request("PUT", path, body),
    post: (path, body) => request("POST", path, body),
  },
  notify: showToast,
  dismiss: dismissToast,
  confirm: (message) =>
    new Promise((resolve) =>
      Alert.alert("Kitaab", message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ]),
    ),
  attention() {
    if (AppState.currentState === "active") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  },
  storage: { get: kv.get, set: kv.set },
  async base64(url) {
    if (url.startsWith("data:")) return url.slice(url.indexOf(",") + 1)
    return new File(url).base64()
  },
})
