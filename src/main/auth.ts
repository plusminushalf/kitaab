import { app, BrowserWindow, safeStorage, shell } from "electron"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"

// Sign-in to a Hermes dashboard that requires login, the way a native app should
// (RFC 8252): the system browser shows Hermes's own login page, the code comes
// back to a loopback redirect, and we redeem it with a PKCE verifier. The app
// never sees the password. Tokens are kept encrypted with the macOS keychain.

type Tokens = { access_token: string; refresh_token: string; expires_at: number; provider?: string }

const file = () => join(app.getPath("userData"), "auth.json")

function readAll(): Record<string, string> {
  try {
    return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {}
  } catch {
    return {}
  }
}

function load(server: string): Tokens | null {
  const enc = readAll()[server]
  if (!enc || !safeStorage.isEncryptionAvailable()) return null
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(enc, "base64")))
  } catch {
    return null
  }
}

function store(server: string, tokens: Tokens | null) {
  const all = readAll()
  if (tokens) all[server] = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64")
  else delete all[server]
  writeFileSync(file(), JSON.stringify(all, null, 2))
}

/** Expiry in ms; the server may send seconds or milliseconds. */
const expiresMs = (t: Tokens) => (t.expires_at < 1e12 ? t.expires_at * 1000 : t.expires_at)

export class AuthError extends Error {
  constructor(message: string, readonly needsSignIn = true) {
    super(message)
  }
}

/** Whether the dashboard wants a login at all. */
export async function authRequired(baseUrl: string): Promise<boolean> {
  const res = await fetch(`${baseUrl}/api/status`)
  if (!res.ok) throw new Error(`Hermes answered ${res.status} at ${baseUrl}`)
  const status = (await res.json()) as { auth_required?: boolean }
  return Boolean(status.auth_required)
}

const refreshing = new Map<string, Promise<Tokens | null>>()

/** A valid access token, refreshed if needed. Throws AuthError when the user must sign in. */
export async function accessToken(server: string, baseUrl: string): Promise<string> {
  let tokens = load(server)
  if (!tokens) throw new AuthError("Sign in to your Hermes server")
  if (expiresMs(tokens) - Date.now() < 120_000) {
    let p = refreshing.get(server)
    if (!p) {
      p = refresh(baseUrl, tokens).finally(() => refreshing.delete(server))
      refreshing.set(server, p)
    }
    tokens = await p
    store(server, tokens)
    if (!tokens) throw new AuthError("Your Hermes sign-in expired")
  }
  return tokens.access_token
}

async function refresh(baseUrl: string, tokens: Tokens): Promise<Tokens | null> {
  const res = await fetch(`${baseUrl}/auth/native/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token, provider: tokens.provider ?? "" }),
  })
  if (res.status === 401 || res.status === 400) return null
  if (!res.ok) throw new AuthError(`Couldn't refresh the sign-in (${res.status})`, false)
  return (await res.json()) as Tokens
}

export function signOut(server: string) {
  store(server, null)
}

let pendingSignIn: Promise<void> | null = null

/** Opens the Hermes login page in the browser and waits for the loopback redirect. */
export function signIn(server: string, baseUrl: string): Promise<void> {
  pendingSignIn ??= runSignIn(server, baseUrl).finally(() => (pendingSignIn = null))
  return pendingSignIn
}

async function runSignIn(server: string, baseUrl: string) {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const state = randomBytes(16).toString("base64url")

  const code = await new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/callback") return void res.writeHead(404).end()
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code")
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" })
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Kitab</title>` +
          `<body style="font:15px -apple-system,system-ui;display:grid;place-items:center;height:90vh;margin:0">` +
          (ok ? "Signed in. You can close this tab and go back to Kitab." : "Sign-in failed. Try again from the app.") +
          `<script>setTimeout(()=>window.close(),800)</script>`,
      )
      srv.close()
      clearTimeout(timer)
      if (ok) resolve(url.searchParams.get("code")!)
      else reject(new Error("Sign-in was cancelled or failed"))
    })
    const timer = setTimeout(() => {
      srv.close()
      reject(new Error("Sign-in timed out"))
    }, 5 * 60_000)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      const authorize = new URL(`${baseUrl}/auth/native/authorize`)
      authorize.searchParams.set("code_challenge", challenge)
      authorize.searchParams.set("code_challenge_method", "S256")
      authorize.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`)
      authorize.searchParams.set("state", state)
      void shell.openExternal(authorize.toString())
    })
  })

  const res = await fetch(`${baseUrl}/auth/native/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  })
  if (!res.ok) throw new Error(`Hermes rejected the sign-in (${res.status})`)
  store(server, (await res.json()) as Tokens)

  // Bring the app back to the front once the browser part is done.
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    app.focus({ steal: true })
    win.focus()
  }
}

/** One-time ticket for opening /api/ws (valid ~30s). */
export async function wsTicket(server: string, baseUrl: string): Promise<string> {
  const res = await authedFetch(server, baseUrl, "/api/auth/ws-ticket", { method: "POST" })
  const body = (await res.json()) as { ticket: string }
  return body.ticket
}

export async function authedFetch(server: string, baseUrl: string, path: string, init: RequestInit = {}) {
  const needsAuth = await authRequiredCached(baseUrl)
  const headers = new Headers(init.headers)
  if (needsAuth) headers.set("authorization", `Bearer ${await accessToken(server, baseUrl)}`)
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
  if (res.status === 401) {
    if (needsAuth) store(server, null)
    throw new AuthError("Sign in to your Hermes server")
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}`)
  return res
}

const authCache = new Map<string, boolean>()
async function authRequiredCached(baseUrl: string) {
  if (!authCache.has(baseUrl)) authCache.set(baseUrl, await authRequired(baseUrl))
  return authCache.get(baseUrl)!
}
export function forgetAuthMode(baseUrl: string) {
  authCache.delete(baseUrl)
}
