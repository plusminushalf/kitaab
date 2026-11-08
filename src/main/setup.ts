import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { findHermesScript, parseFindHermes } from "@kitab/core/remote"
import type { SetupProblem, SetupResult, SetupStep, SetupTarget } from "../shared/bridge"
import { ensureRemoteBackend, sshScript } from "./remote"

// The first-run check: tries a connection one step at a time and, when a step fails,
// says what's wrong in plain words with the command that fixes it.

const HERMES_INSTALL = "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
const HERMES_DOCS = { label: "Hermes Agent docs", url: "https://hermes-agent.nousresearch.com/docs" }

type Progress = (steps: SetupStep[]) => void

class Steps {
  constructor(
    public list: SetupStep[],
    private progress: Progress,
  ) {
    this.send()
  }
  set(id: string, patch: Partial<SetupStep>) {
    this.list = this.list.map((s) => (s.id === id ? { ...s, ...patch } : s))
    this.send()
  }
  fail(id: string, problem: SetupProblem): SetupResult {
    this.set(id, { state: "failed", problem })
    return { ok: false, steps: this.list }
  }
  private send() {
    this.progress(this.list)
  }
}

export function checkTarget(target: SetupTarget, progress: Progress, forward: (host: string, port: number) => Promise<string>) {
  return target.kind === "ssh" ? checkSsh(target.host.trim(), progress, forward) : checkUrl(target.url.trim(), progress)
}

async function checkSsh(host: string, progress: Progress, forward: (host: string, port: number) => Promise<string>): Promise<SetupResult> {
  const steps = new Steps(
    [
      { id: "reach", label: `Reach ${host}`, state: "running" },
      { id: "auth", label: "Sign in with your SSH key", state: "pending" },
      { id: "hermes", label: "Find Hermes", state: "pending" },
      { id: "start", label: "Start Kitaab's Hermes backend", state: "pending" },
    ],
    progress,
  )

  // Reach and sign in: one round trip, and ssh's error says which of the two failed.
  try {
    await sshScript(host, "true", 20_000)
  } catch (e) {
    const p = await explainSsh(host, message(e))
    if (p.step === "auth") steps.set("reach", { state: "ok" })
    return steps.fail(p.step === "auth" ? "auth" : "reach", p)
  }
  steps.set("reach", { state: "ok" })
  steps.set("auth", { state: "ok" })

  steps.set("hermes", { state: "running" })
  let found: ReturnType<typeof parseFindHermes>
  try {
    found = parseFindHermes(await sshScript(host, findHermesScript(), 30_000))
  } catch (e) {
    return steps.fail("hermes", await explainSsh(host, message(e)))
  }
  if (!found) {
    return steps.fail("hermes", {
      title: `Hermes not found on ${host}`,
      explain: `Kitaab looked on your PATH, in ~/.local/bin and in your login shell. Install Hermes Agent on ${host}, then try again:`,
      command: HERMES_INSTALL,
      link: HERMES_DOCS,
    })
  }
  if (!found.serves) {
    return steps.fail("hermes", {
      title: `Hermes on ${host} is too old`,
      explain: `Kitaab needs a newer version of hermes serve. Update it on ${host}, then try again:`,
      command: "hermes update",
      output: `Found ${found.path}`,
    })
  }
  steps.set("hermes", { state: "ok", detail: found.path.replace(/^\/(home|Users)\/[^/]+/, "~") })

  steps.set("start", { state: "running" })
  let baseUrl: string
  try {
    baseUrl = (await ensureRemoteBackend(host, (port) => forward(host, port))).baseUrl
  } catch (e) {
    return steps.fail("start", await explainConnectError(host, message(e)))
  }
  // The version comes from the running backend: `hermes --version` is slow (it checks for updates).
  const version = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ version?: string }>)
    .then((s) => s.version)
    .catch(() => undefined)
  steps.set("start", { state: "ok", detail: version ? `Hermes ${version}` : undefined })
  return { ok: true, steps: steps.list }
}

async function checkUrl(input: string, progress: Progress): Promise<SetupResult> {
  const steps = new Steps(
    [
      { id: "reach", label: "Reach the dashboard", state: "running" },
      { id: "hermes", label: "Check it's Hermes", state: "pending" },
      { id: "signin", label: "Check sign-in", state: "pending" },
    ],
    progress,
  )

  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `http://${input}`)
    if (!/^https?:$/.test(url.protocol)) throw new Error()
  } catch {
    return steps.fail("reach", {
      title: "That isn't a web address",
      explain: "Use the dashboard's address, like http://127.0.0.1:9119.",
    })
  }
  const base = url.origin
  let res: Response
  try {
    res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(8000) })
  } catch (e) {
    return steps.fail("reach", explainFetch(url, e))
  }
  steps.set("reach", { state: "ok" })

  steps.set("hermes", { state: "running" })
  const status = res.ok ? ((await res.json().catch(() => null)) as { version?: string; auth_required?: boolean } | null) : null
  if (!status || typeof status !== "object") {
    return steps.fail("hermes", {
      title: "That isn't a Hermes dashboard",
      explain: `Something answered at ${url.host}, but not the way Hermes does. Check the address and port.`,
      output: `GET ${base}/api/status → ${res.status} ${res.statusText}`,
    })
  }
  steps.set("hermes", { state: "ok", detail: status.version ? `Hermes ${status.version}` : undefined })
  steps.set("signin", {
    state: "ok",
    detail: status.auth_required ? "You'll sign in with your browser next" : "No sign-in needed",
  })
  return { ok: true, steps: steps.list }
}

function explainFetch(url: URL, e: unknown): SetupProblem {
  const cause = (e as { cause?: { code?: string; message?: string; errors?: { code?: string }[] } })?.cause
  // "localhost" tries IPv6 and IPv4, and the codes come back inside an AggregateError.
  const code = cause?.code ?? cause?.errors?.[0]?.code ?? ""
  const raw = cause?.message ?? message(e)
  if (code === "ECONNREFUSED") {
    return {
      title: `Nothing is answering at ${url.host}`,
      explain: "Start the Hermes dashboard there, then try again:",
      command: "hermes dashboard",
      output: raw,
    }
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { title: `Can't find ${url.hostname}`, explain: "There's no machine by that name. Check the spelling.", output: raw }
  }
  if ((e as Error)?.name === "TimeoutError" || code === "ETIMEDOUT" || code === "EHOSTUNREACH") {
    return {
      title: `${url.host} didn't answer`,
      explain: "It may be off or on a network this Mac can't reach. Check your VPN or Tailscale.",
      output: raw,
    }
  }
  return { title: `Couldn't reach ${url.host}`, explain: "The request failed:", output: raw }
}

/** ssh's error, in plain words. `step` says whether reaching the host or signing in failed. */
async function explainSsh(host: string, raw: string): Promise<SetupProblem & { step: "reach" | "auth" | "other" }> {
  const output = raw.replace(/^ssh [^:]+: /, "")
  const reach = (title: string, explain: string, command?: string) => ({ step: "reach" as const, title, explain, command, output })
  const auth = (title: string, explain: string, command?: string) => ({ step: "auth" as const, title, explain, command, output })

  if (/Could not resolve hostname/i.test(raw)) {
    return reach(`Can't find ${host}`, "There's no machine by that name. Check the spelling, or add a Host entry for it to ~/.ssh/config.")
  }
  if (/Connection refused/i.test(raw)) {
    return reach(
      `${host} isn't accepting SSH connections`,
      "The machine answered, but nothing is listening for SSH. If it's a Mac, turn on Remote Login in System Settings → General → Sharing.",
    )
  }
  if (/timed out|No route to host|Network is unreachable|Host is down/i.test(raw)) {
    return reach(`${host} didn't answer`, "It may be off, asleep, or on a network this Mac can't reach. Check your VPN or Tailscale.")
  }
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(raw)) {
    return auth(
      `${host}'s host key has changed`,
      "SSH won't connect because the machine identifies itself differently than before. If you reinstalled it, remove its old line from ~/.ssh/known_hosts. Running this in Terminal shows which line:",
      `ssh ${host}`,
    )
  }
  if (/Host key verification failed/i.test(raw)) {
    return auth(
      `${host} isn't trusted yet`,
      "This Mac hasn't connected to it before, and Kitaab won't accept a new host key on its own. Connect once in Terminal and answer “yes”:",
      `ssh ${host}`,
    )
  }
  if (/Too many authentication failures/i.test(raw)) {
    return auth(
      `${host} turned away too many keys`,
      "Your SSH agent offered more keys than the server allows. Add IdentityFile and IdentitiesOnly yes for this host in ~/.ssh/config.",
    )
  }
  if (/Permission denied/i.test(raw)) {
    if (!/publickey/i.test(raw)) {
      return auth(`${host} only allows passwords`, "Kitaab signs in with an SSH key. Copy yours there once (it asks for the password):", `ssh-copy-id ${host}`)
    }
    const keys = await agentKeys()
    if (keys > 0) {
      return auth(
        `${host} didn't accept your SSH key`,
        "Your key is loaded, but the server doesn't list it as allowed. Copy it there (it asks for the password once):",
        `ssh-copy-id ${host}`,
      )
    }
    const keyFile = localKeyFile()
    if (!keyFile) {
      return auth(`No SSH key on this Mac`, `Make one, then copy it to ${host}:`, `ssh-keygen -t ed25519 && ssh-copy-id ${host}`)
    }
    return auth(
      "SSH key not loaded",
      "Kitaab can't type a passphrase, so your key has to be in the SSH agent. Add it, then try again:",
      `ssh-add --apple-use-keychain ${keyFile}`,
    )
  }
  if (/bad owner or permissions|Bad configuration option|Bad port|terminating, \d+ bad configuration/i.test(raw)) {
    return reach("Your SSH config has a problem", "ssh stopped before connecting. Here's what it said:")
  }
  return { step: "other", title: `Couldn't connect to ${host}`, explain: "ssh said:", output }
}

/** Why connecting to the SSH host failed, for both the first-run check and the app's status. */
export async function explainConnectError(host: string, raw: string): Promise<SetupProblem> {
  const out = raw.replace(/^Couldn't start Hermes on [^:]+: /, "")
  if (/ERR hermes not found/.test(out)) {
    return {
      title: `Hermes not found on ${host}`,
      explain: `Install Hermes Agent on ${host}, then try again:`,
      command: HERMES_INSTALL,
      link: HERMES_DOCS,
    }
  }
  if (/^DIED/m.test(out)) {
    return {
      title: "Hermes stopped as soon as it started",
      explain: `This is the end of its log. Running hermes doctor on ${host} may say more:`,
      command: "hermes doctor",
      output: out.replace(/^DIED\s*/m, ""),
    }
  }
  if (/^TIMEOUT/m.test(out)) {
    return { title: "Hermes took too long to start", explain: "This is the end of its log:", output: out.replace(/^TIMEOUT\s*/m, "") }
  }
  if (/ERR cannot create/.test(out)) {
    return { title: `Kitaab can't write to ~/.hermes on ${host}`, explain: "Check that your user owns ~/.hermes there.", output: out }
  }
  if (/Timed out opening an SSH tunnel|^ssh \S+ exited/m.test(out)) {
    return {
      title: "Couldn't open a tunnel to Hermes",
      explain: "SSH signs in, but port forwarding failed. The server may have AllowTcpForwarding turned off in sshd_config.",
      output: out,
    }
  }
  const { step, ...p } = await explainSsh(host, out)
  return step === "other" ? { title: `Couldn't start Hermes on ${host}`, explain: "It said:", output: out } : p
}

/** One line for the status in the sidebar and Settings; the raw error when there's nothing plainer to say. */
export async function plainConnectError(host: string, raw: string): Promise<string> {
  const p = await explainConnectError(host, raw)
  if (p.title.startsWith("Couldn't start Hermes")) return raw
  return p.command ? `${p.title}. Run \`${p.command}\` in Terminal.` : `${p.title}.`
}

/** How many keys the SSH agent holds (0 if none, or if there's no agent). */
function agentKeys(): Promise<number> {
  return new Promise((resolve) => {
    execFile("ssh-add", ["-l"], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? 0 : stdout.split("\n").filter((l) => l.trim()).length)
    })
  })
}

function localKeyFile(): string | null {
  for (const name of ["id_ed25519", "id_ecdsa", "id_rsa"]) {
    if (existsSync(join(homedir(), ".ssh", name))) return `~/.ssh/${name}`
  }
  return null
}

/** Host aliases from ~/.ssh/config, without wildcard patterns. */
export function sshConfigHosts(): string[] {
  try {
    const text = readFileSync(join(homedir(), ".ssh", "config"), "utf8")
    const hosts = new Set<string>()
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*Host\s+(.+)$/i)
      if (!m) continue
      for (const h of m[1].split(/\s+/)) if (h && !/[*?!]/.test(h)) hosts.add(h)
    }
    return [...hosts]
  } catch {
    return []
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
