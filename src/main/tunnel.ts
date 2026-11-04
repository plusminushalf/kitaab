import { spawn, type ChildProcess } from "node:child_process"
import { createServer, connect } from "node:net"

// An SSH port forward to the Hermes dashboard on another machine.
// This is transport only: the app still never starts or manages Hermes itself.
export class Tunnel {
  private proc: ChildProcess | null = null
  private key = ""
  private port = 0

  private opening: Promise<number> | null = null

  open(host: string, remotePort: number): Promise<number> {
    this.opening ??= this.openOnce(host, remotePort).finally(() => (this.opening = null))
    return this.opening
  }

  private async openOnce(host: string, remotePort: number): Promise<number> {
    const key = `${host}:${remotePort}`
    if (this.proc && this.proc.exitCode === null && this.key === key && (await isOpen(this.port))) return this.port
    this.close()

    const port = (await portFree(19119)) ? 19119 : await freePort()
    const proc = spawn(
      "ssh",
      [
        "-N",
        "-o", "BatchMode=yes",
        // Own connection: with ControlMaster the forward would be handed to a
        // shared master and this process would exit, leaving us nothing to manage.
        "-o", "ControlMaster=no",
        "-o", "ControlPath=none",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=3",
        "-L", `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
        host,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let stderr = ""
    proc.stderr?.on("data", (d) => (stderr += String(d)))
    console.log(`[tunnel] ssh -L ${port} -> ${host}:${remotePort} (pid ${proc.pid})`)
    this.proc = proc
    this.key = key
    this.port = port

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`ssh ${host} exited: ${stderr.trim() || proc.exitCode}`)
      if (await isOpen(port)) return port
      await new Promise((r) => setTimeout(r, 150))
    }
    this.close()
    console.log(`[tunnel] timed out; ssh stderr: ${stderr.trim()}`)
    throw new Error(`Timed out opening an SSH tunnel to ${host}`)
  }

  close() {
    this.proc?.kill()
    this.proc = null
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function isOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: "127.0.0.1" })
    s.once("connect", () => (s.destroy(), resolve(true)))
    s.once("error", () => resolve(false))
  })
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once("error", () => resolve(false))
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)))
  })
}
