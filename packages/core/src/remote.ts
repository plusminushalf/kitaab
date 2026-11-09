// Kitaab's private Hermes backend on an SSH host, shared by every device.
//
// Over SSH, a Kitaab app starts `hermes serve --isolated` bound to loopback with a token it
// mints, the way the official Hermes app does, under ~/.hermes/desktop-ssh/<ownershipId>/.
// Hermes deletes its token file once it has read it, so Kitaab also keeps a private copy
// (`kitab-token`, mode 600) next to the lockfile. That copy is what lets the Mac and the
// iPhone find and share one backend: SSH access is already the credential, and anyone who
// can read the file could equally start a backend of their own.
//
// These are plain POSIX sh scripts plus parsers. Each app runs them its own way (the Mac
// with the `ssh` binary, the iPhone with its in-app SSH client) and sends the script on stdin.

export type LiveBackend = { ownershipId: string; pid: number; port: number; token: string; startedAt?: string }

const ROOT = '"$HOME/.hermes/desktop-ssh"'
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const hex = (s: string, len: number) => {
  if (!new RegExp(`^[0-9a-f]{${len}}$`).test(s)) throw new Error(`expected ${len} hex characters`)
  return s
}

/** Sets $hermes to the hermes binary: on PATH, in ~/.local/bin, or on the login shell's PATH. Empty if none. */
const FIND_HERMES = `hermes=""
for c in "$(command -v hermes 2>/dev/null)" "$HOME/.local/bin/hermes" "$("\${SHELL:-sh}" -lc 'command -v hermes' 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then hermes="$c"; break; fi
done`

/**
 * Defines `kitab_lock <dir> <pid> <port> <nonce> <token> <hermes> <startedAt>`, which writes
 * <dir>/backend.lock.json in the official Hermes app's format (schema 2). Whenever any `hermes
 * serve` starts on the host, Hermes kills every detached loopback `serve --port 0` it takes for a
 * crashed app's leftover, unless a valid lockfile claims its pid. Our backend is detached on
 * purpose, so without this file a second backend starting (another device, an agent's demo
 * server) killed it mid-turn. The nonce must be the one the backend was started with: Hermes
 * also retires a backend once its lockfile names another spawn.
 */
const WRITE_LOCK = `kitab_lock() {
  fp=$(printf '%s' "$5" | { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; } | cut -c1-32)
  case "$fp" in ""|*[!0-9a-f]*) return 0;; esac
  [ \${#fp} -eq 32 ] || return 0
  esc() { printf '%s' "$1" | sed 's/[\\\\"]/\\\\&/g'; }
  printf '{"schemaVersion":2,"protocolVersion":1,"ownershipId":"%s","spawnNonce":"%s","tokenFingerprint":"%s","pid":%s,"port":%s,"profile":"default","hermesPath":"%s","hermesHome":"%s","logPath":"%s","startedAt":"%s"}' "\${1##*/}" "$4" "$fp" "$2" "$3" "$(esc "$6")" "$(esc "\${HERMES_HOME:-$HOME/.hermes}")" "$(esc "$1/$4.log")" "$7" > "$1/backend.lock.json.tmp" && mv -f "$1/backend.lock.json.tmp" "$1/backend.lock.json"
}`

/**
 * Looks for Hermes the way spawnScript does, for a setup check. Prints `NOHERMES`, or
 * `HERMES <path>` and `SERVE ok` or `SERVE old` (no SSH session support). Not `hermes --version`:
 * it checks for updates and can take most of a minute.
 */
export function findHermesScript(): string {
  return `
${FIND_HERMES}
[ -n "$hermes" ] || { echo "NOHERMES"; exit 0; }
echo "HERMES $hermes"
if "$hermes" serve --help 2>&1 | grep -q -- --ssh-session-token-file; then echo "SERVE ok"; else echo "SERVE old"; fi
`
}

export function parseFindHermes(out: string): { path: string; serves: boolean } | null {
  const path = out.match(/^HERMES (.+)$/m)?.[1]
  if (!path) return null
  return { path, serves: /^SERVE ok$/m.test(out) }
}

/**
 * Lists every live Kitaab backend on the host. One `LIVE …` line each. Also writes Hermes's
 * lockfile (see WRITE_LOCK) for a backend that has none, or whose lockfile names an earlier
 * spawn (an older Kitaab build started it): a stale one makes Hermes retire the live backend.
 * Only after checking that the backend runs with the nonce it records.
 */
export function discoverScript(): string {
  return `
umask 077
root=${ROOT}
[ -d "$root" ] || exit 0
${WRITE_LOCK}
for d in "$root"/*/; do
  d="\${d%/}"
  [ -f "$d/kitab-token" ] && [ -f "$d/hermes-desktop.json" ] || continue
  lock=$(cat "$d/hermes-desktop.json")
  pid=$(printf '%s' "$lock" | sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p')
  port=$(printf '%s' "$lock" | sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p')
  started=$(printf '%s' "$lock" | sed -n 's/.*"startedAt":"\\([^"]*\\)".*/\\1/p')
  [ -n "$pid" ] && [ -n "$port" ] && kill -0 "$pid" 2>/dev/null || continue
  nonce=$(printf '%s' "$lock" | sed -n 's/.*"nonce":"\\([0-9a-f]\\{16\\}\\)".*/\\1/p')
  if [ -n "$nonce" ] && ! grep -q "\\"spawnNonce\\":\\"$nonce\\"" "$d/backend.lock.json" 2>/dev/null; then
    rm -f "$d/backend.lock.json"
    if ps -o args= -p "$pid" 2>/dev/null | grep -q -- "--ssh-owner-nonce $nonce"; then
      kitab_lock "$d" "$pid" "$port" "$nonce" "$(cat "$d/kitab-token")" "$(command -v hermes 2>/dev/null)" "\${started:-}"
    fi
  fi
  printf 'LIVE %s %s %s %s %s\\n' "\${d##*/}" "$pid" "$port" "$(cat "$d/kitab-token")" "\${started:--}"
done
`
}

export function parseDiscover(out: string): LiveBackend[] {
  const found: LiveBackend[] = []
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^LIVE ([0-9a-f]{32}) (\d+) (\d+) ([0-9a-f]{64}) (\S+)$/)
    if (m) found.push({ ownershipId: m[1], pid: Number(m[2]), port: Number(m[3]), token: m[4], startedAt: m[5] === "-" ? undefined : m[5] })
  }
  // Oldest first: every device makes the same choice, so they all end up on one backend.
  return found.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
}

/** Records the token for a backend started before Kitaab kept a copy (so other devices can find it). */
export function adoptScript(ownershipId: string, token: string): string {
  return `umask 077; d=${ROOT}/${hex(ownershipId, 32)}; [ -d "$d" ] && printf '%s' ${sq(hex(token, 64))} > "$d/kitab-token"; true`
}

/** Stops this device's own backend (shared or from before tokens were shared) and clears its lockfile. */
export function retireScript(ownershipId: string): string {
  return `d=${ROOT}/${hex(ownershipId, 32)}; f="$d/hermes-desktop.json"; [ -f "$f" ] && pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$f") && [ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$f" "$d/kitab-token" "$d/backend.lock.json"; true`
}

/** Starts a fresh backend. Prints `READY <pid> <port>` or a failure with the log's tail. */
export function spawnScript(ownershipId: string, token: string, nonce: string): string {
  hex(ownershipId, 32)
  hex(token, 64)
  hex(nonce, 16)
  return `
set -u
umask 077
root=${ROOT}
dir="$root/${ownershipId}"
mkdir -p "$dir" && chmod 700 "$dir" || { echo "ERR cannot create $dir"; exit 1; }
rm -f "$dir"/*.log.old "$dir/backend.lock.json" 2>/dev/null
for f in "$dir"/*.log; do [ -f "$f" ] && mv -f "$f" "$f.old"; done 2>/dev/null

${FIND_HERMES}
[ -n "$hermes" ] || { echo "ERR hermes not found on PATH"; exit 1; }
${WRITE_LOCK}

token_file="$dir/${nonce}.token"
log="$dir/${nonce}.log"
printf '%s' '${token}' > "$token_file" && chmod 600 "$token_file"
printf '%s' '${token}' > "$dir/kitab-token" && chmod 600 "$dir/kitab-token"

launcher="$(command -v setsid || echo nohup)"
child=$("$launcher" sh -c 'ulimit -n 65536 2>/dev/null || true; exec env HERMES_DESKTOP=1 "$0" serve --isolated --host 127.0.0.1 --port 0 --ssh-session-token-file "$1" --ssh-owner-nonce "$2" </dev/null >>"$3" 2>&1 & echo $!' "$hermes" "$token_file" '${nonce}' "$log")

i=0
while [ $i -lt 200 ]; do
  port=$(grep -oE 'HERMES_(DASHBOARD|BACKEND)_READY port=[0-9]+' "$log" 2>/dev/null | tail -n 1 | sed 's/.*=//')
  if [ -n "$port" ]; then
    started=$(date -u +%FT%TZ)
    printf '{"pid":%s,"port":%s,"nonce":"%s","startedAt":"%s"}' "$child" "$port" '${nonce}' "$started" > "$dir/hermes-desktop.json"
    kitab_lock "$dir" "$child" "$port" '${nonce}' '${token}' "$hermes" "$started"
    echo "READY $child $port"
    exit 0
  fi
  if ! kill -0 "$child" 2>/dev/null; then
    rm -f "$token_file" "$dir/kitab-token"
    echo "DIED"; tail -n 15 "$log"; exit 1
  fi
  sleep 0.75
  i=$((i+1))
done
kill "$child" 2>/dev/null
rm -f "$dir/kitab-token"
echo "TIMEOUT"; tail -n 15 "$log"; exit 1
`
}

export function parseSpawn(out: string): { pid: number; port: number } {
  const m = out.match(/READY (\d+) (\d+)/)
  if (!m) throw new Error(out.trim().slice(-400) || "no answer from the host")
  return { pid: Number(m[1]), port: Number(m[2]) }
}

/** Stops every Kitaab backend on the host and forgets their tokens. */
export function stopScript(): string {
  return `
root=${ROOT}
for d in "$root"/*/; do
  d="\${d%/}"
  [ -f "$d/kitab-token" ] || continue
  f="$d/hermes-desktop.json"
  [ -f "$f" ] && pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$f") && [ -n "$pid" ] && kill "$pid" 2>/dev/null
  rm -f "$f" "$d/kitab-token" "$d/backend.lock.json"
done
true
`
}

/** Random lowercase hex from a source of random bytes. */
export function randomHex(bytes: number, random: (n: number) => Uint8Array): string {
  return Array.from(random(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
}

export type SshRunner = {
  /** Runs a sh script on the host (sent on stdin) and resolves to its stdout. */
  exec(script: string, timeoutMs?: number): Promise<string>
  /** Forwards a local port to 127.0.0.1:<remotePort> on the host; resolves to the local base URL. */
  forward(remotePort: number): Promise<string>
}

/** Checks a token against a backend through its base URL. */
export async function tokenWorks(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/sessions?limit=1`, { headers: { "x-hermes-session-token": token } })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Finds the live Kitaab backend on the host (the oldest, so every device picks the same one), or starts one.
 * Resolves to the local base URL and token. `known` is a token this device remembers for
 * its own backend, used once to adopt a backend started before tokens were shared.
 */
export async function ensureBackend(
  ssh: SshRunner,
  opts: { ownershipId: string; known?: { token: string } | null; random: (n: number) => Uint8Array; fetch?: typeof fetch },
): Promise<{ baseUrl: string; token: string; pid: number; port: number }> {
  const f = opts.fetch ?? fetch
  const live = parseDiscover(await ssh.exec(discoverScript()))
  for (const b of live) {
    const baseUrl = await ssh.forward(b.port)
    if (!(await tokenWorks(baseUrl, b.token, f))) continue
    // On someone else's backend: stop the one this device left behind, if any.
    if (b.ownershipId !== opts.ownershipId) await ssh.exec(retireScript(opts.ownershipId)).catch(() => {})
    return { baseUrl, token: b.token, pid: b.pid, port: b.port }
  }

  // A backend this device started before Kitaab shared tokens: adopt it.
  if (opts.known?.token) {
    const lock = await ssh.exec(`cat ${ROOT}/${hex(opts.ownershipId, 32)}/hermes-desktop.json 2>/dev/null || true`)
    const pid = Number(lock.match(/"pid":(\d+)/)?.[1])
    const port = Number(lock.match(/"port":(\d+)/)?.[1])
    if (pid && port && (await ssh.exec(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`)).trim() === "yes") {
      const baseUrl = await ssh.forward(port)
      if (await tokenWorks(baseUrl, opts.known.token, f)) {
        await ssh.exec(adoptScript(opts.ownershipId, opts.known.token))
        return { baseUrl, token: opts.known.token, pid, port }
      }
    }
  }

  const token = randomHex(32, opts.random)
  const nonce = randomHex(8, opts.random)
  const out = await ssh.exec(spawnScript(opts.ownershipId, token, nonce), 180_000)
  const { pid, port } = parseSpawn(out)
  const baseUrl = await ssh.forward(port)
  return { baseUrl, token, pid, port }
}
