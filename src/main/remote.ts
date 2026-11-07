import { app, safeStorage } from "electron"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureBackend, stopScript } from "@kitab/core/remote"

// SSH mode: the scripts and the find-or-start logic live in @kitab/core/remote, shared
// with the iPhone app, so both devices end up on the same private backend. This file
// runs them with the `ssh` binary and remembers this Mac's ownership id and token.
// Our own ownership id keeps us clear of the official app's backends on the same machine.

type Local = { ownershipId: string; tokenEnc?: string; pid?: number; port?: number }

const localFile = () => join(app.getPath("userData"), "remote.json")

function readLocal(host: string): Local {
  let all: Record<string, Local> = {}
  try {
    if (existsSync(localFile())) all = JSON.parse(readFileSync(localFile(), "utf8"))
  } catch {}
  return all[host] ?? { ownershipId: randomBytes(16).toString("hex") }
}

function writeLocal(host: string, value: Local) {
  let all: Record<string, Local> = {}
  try {
    if (existsSync(localFile())) all = JSON.parse(readFileSync(localFile(), "utf8"))
  } catch {}
  all[host] = value
  writeFileSync(localFile(), JSON.stringify(all, null, 2))
}

const encrypt = (s: string) => safeStorage.encryptString(s).toString("base64")
const decrypt = (s?: string) => {
  if (!s) return null
  try {
    return safeStorage.decryptString(Buffer.from(s, "base64"))
  } catch {
    return null
  }
}

/** Runs a POSIX sh script on the host. The script travels on stdin, so nothing secret lands in argv. */
export function sshScript(host: string, script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "sh -s"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error(`ssh ${host} timed out`))
    }, timeoutMs)
    proc.stdout.on("data", (d) => (out += String(d)))
    proc.stderr.on("data", (d) => (err += String(d)))
    proc.on("error", (e) => (clearTimeout(timer), reject(e)))
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`ssh ${host}: ${err.trim() || out.trim() || `exit ${code}`}`))
    })
    proc.stdin.end(script)
  })
}

/** Returns a Kitaab backend on the host: one any device already runs, else a fresh one. */
export async function ensureRemoteBackend(host: string, forward: (remotePort: number) => Promise<string>) {
  const local = readLocal(host)
  const backend = await ensureBackend(
    { exec: (script, timeoutMs) => sshScript(host, script, timeoutMs), forward },
    { ownershipId: local.ownershipId, known: tokenOf(local), random: (n) => randomBytes(n) },
  ).catch((e: Error) => {
    throw new Error(`Couldn't start Hermes on ${host}: ${e.message.replace(/^ssh [^:]+: /, "")}`)
  })
  writeLocal(host, { ownershipId: local.ownershipId, tokenEnc: encrypt(backend.token), pid: backend.pid, port: backend.port })
  return backend
}

const tokenOf = (local: Local) => {
  const token = decrypt(local.tokenEnc)
  return token ? { token } : null
}

/** Stops the Kitaab backend on the host (whichever device started it) and forgets its token. */
export async function stopRemoteBackend(host: string) {
  const local = readLocal(host)
  await sshScript(host, stopScript())
  writeLocal(host, { ownershipId: local.ownershipId })
}
