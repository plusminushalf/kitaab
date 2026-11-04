import { app, safeStorage } from "electron"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// SSH mode, done the way the official Hermes desktop app does it: over SSH we
// start our own private `hermes serve --isolated` on the server, bound to
// loopback, with a session token we mint. Loopback means token auth, so no
// login. The backend keeps running after the app quits and is reused next
// time; a lockfile on the server records which process is ours.
//
// We use our own ownership id, so our backend never collides with the
// official app's backends on the same machine.

type Local = { ownershipId: string; tokenEnc?: string; pid?: number; port?: number }
export type RemoteBackend = { remotePort: number; token: string; pid: number }

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

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Returns our backend on the host, starting one if none is alive.
 * `verify` checks a candidate (through a tunnel) and resolves false if it's unusable.
 */
export async function ensureRemoteBackend(
  host: string,
  verify: (b: RemoteBackend) => Promise<boolean>,
): Promise<RemoteBackend> {
  const local = readLocal(host)
  const dir = `$HOME/.hermes/desktop-ssh/${local.ownershipId}`

  // 1. Reuse: our lockfile names a live pid and we still hold its token.
  const token = decrypt(local.tokenEnc)
  if (token) {
    const lock = await sshScript(host, `cat "${dir}/hermes-desktop.json" 2>/dev/null || true`)
    try {
      const { pid, port } = JSON.parse(lock) as { pid: number; port: number }
      const alive = (await sshScript(host, `kill -0 ${Number(pid)} 2>/dev/null && echo yes || echo no`)).trim() === "yes"
      if (alive && port) {
        const candidate = { remotePort: port, token, pid }
        if (await verify(candidate)) return candidate
        // Alive but not answering to our token: stop it before starting fresh.
        await sshScript(host, `kill ${Number(pid)} 2>/dev/null || true`)
      }
    } catch {}
  }

  // 2. Spawn a fresh one.
  const freshToken = randomBytes(32).toString("hex")
  const nonce = randomBytes(8).toString("hex")
  const script = `
set -u
umask 077
root="$HOME/.hermes/desktop-ssh"
dir="${dir}"
mkdir -p "$dir" && chmod 700 "$dir" || { echo "ERR cannot create $dir"; exit 1; }
rm -f "$dir"/*.log.old 2>/dev/null
for f in "$dir"/*.log; do [ -f "$f" ] && mv -f "$f" "$f.old"; done 2>/dev/null

hermes=""
for c in "$(command -v hermes 2>/dev/null)" "$HOME/.local/bin/hermes" "$("\${SHELL:-sh}" -lc 'command -v hermes' 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then hermes="$c"; break; fi
done
[ -n "$hermes" ] || { echo "ERR hermes not found on PATH"; exit 1; }

token_file="$dir/${nonce}.token"
log="$dir/${nonce}.log"
printf '%s' ${sq(freshToken)} > "$token_file" && chmod 600 "$token_file"

launcher="$(command -v setsid || echo nohup)"
child=$("$launcher" sh -c 'ulimit -n 65536 2>/dev/null || true; exec env HERMES_DESKTOP=1 "$0" serve --isolated --host 127.0.0.1 --port 0 --ssh-session-token-file "$1" --ssh-owner-nonce "$2" </dev/null >>"$3" 2>&1 & echo $!' "$hermes" "$token_file" ${sq(nonce)} "$log")

i=0
while [ $i -lt 200 ]; do
  port=$(grep -oE 'HERMES_(DASHBOARD|BACKEND)_READY port=[0-9]+' "$log" 2>/dev/null | tail -n 1 | sed 's/.*=//')
  if [ -n "$port" ]; then
    printf '{"pid":%s,"port":%s,"nonce":"%s","startedAt":"%s"}' "$child" "$port" ${sq(nonce)} "$(date -u +%FT%TZ)" > "$dir/hermes-desktop.json"
    echo "READY $child $port"
    exit 0
  fi
  if ! kill -0 "$child" 2>/dev/null; then
    rm -f "$token_file"
    echo "DIED"; tail -n 15 "$log"; exit 1
  fi
  sleep 0.75
  i=$((i+1))
done
kill "$child" 2>/dev/null
echo "TIMEOUT"; tail -n 15 "$log"; exit 1
`
  const out = await sshScript(host, script, 180_000).catch((e: Error) => {
    throw new Error(`Couldn't start Hermes on ${host}: ${e.message.replace(/^ssh [^:]+: /, "")}`)
  })
  const m = out.match(/READY (\d+) (\d+)/)
  if (!m) throw new Error(`Couldn't start Hermes on ${host}: ${out.trim().slice(-400)}`)
  const backend = { pid: Number(m[1]), remotePort: Number(m[2]), token: freshToken }
  writeLocal(host, { ownershipId: local.ownershipId, tokenEnc: encrypt(freshToken), pid: backend.pid, port: backend.remotePort })
  return backend
}

/** Stops our backend on the host (if any) and forgets its token. */
export async function stopRemoteBackend(host: string) {
  const local = readLocal(host)
  const dir = `$HOME/.hermes/desktop-ssh/${local.ownershipId}`
  await sshScript(
    host,
    `f="${dir}/hermes-desktop.json"; [ -f "$f" ] && pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$f") && [ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$f"; true`,
  )
  writeLocal(host, { ownershipId: local.ownershipId })
}
