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

/** Lists every live Kitaab backend on the host. One `LIVE …` line each. */
export function discoverScript(): string {
  return `
root=${ROOT}
[ -d "$root" ] || exit 0
for d in "$root"/*/; do
  d="\${d%/}"
  [ -f "$d/kitab-token" ] && [ -f "$d/hermes-desktop.json" ] || continue
  lock=$(cat "$d/hermes-desktop.json")
  pid=$(printf '%s' "$lock" | sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p')
  port=$(printf '%s' "$lock" | sed -n 's/.*"port":\\([0-9]*\\).*/\\1/p')
  started=$(printf '%s' "$lock" | sed -n 's/.*"startedAt":"\\([^"]*\\)".*/\\1/p')
  [ -n "$pid" ] && [ -n "$port" ] && kill -0 "$pid" 2>/dev/null || continue
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
  return `d=${ROOT}/${hex(ownershipId, 32)}; f="$d/hermes-desktop.json"; [ -f "$f" ] && pid=$(sed -n 's/.*"pid":\\([0-9]*\\).*/\\1/p' "$f") && [ -n "$pid" ] && kill "$pid" 2>/dev/null; rm -f "$f" "$d/kitab-token"; true`
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
rm -f "$dir"/*.log.old 2>/dev/null
for f in "$dir"/*.log; do [ -f "$f" ] && mv -f "$f" "$f.old"; done 2>/dev/null

hermes=""
for c in "$(command -v hermes 2>/dev/null)" "$HOME/.local/bin/hermes" "$("\${SHELL:-sh}" -lc 'command -v hermes' 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then hermes="$c"; break; fi
done
[ -n "$hermes" ] || { echo "ERR hermes not found on PATH"; exit 1; }

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
    printf '{"pid":%s,"port":%s,"nonce":"%s","startedAt":"%s"}' "$child" "$port" '${nonce}' "$(date -u +%FT%TZ)" > "$dir/hermes-desktop.json"
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
  rm -f "$f" "$d/kitab-token"
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
