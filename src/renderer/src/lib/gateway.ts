// JSON-RPC 2.0 over Hermes's /api/ws (tui_gateway). Plain WebSocket, no Electron
// IPC: the main process only hands us a URL with a one-time ticket.

export type GatewayEvent = { type: string; session_id?: string; payload?: any; seq?: number }
export type ServerRequest = { id: string; method: string; params: any }

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

export class Gateway {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private ping: ReturnType<typeof setInterval> | undefined
  private lastHeard = 0
  private closedByUs = false
  replayEpoch: string | null = null

  onEvent: (e: GatewayEvent) => void = () => {}
  onRequest: (r: ServerRequest) => void = () => {}
  onClose: (reason: string) => void = () => {}

  /** Opens the socket and resolves once the server says gateway.ready. */
  open(url: string): Promise<void> {
    this.closedByUs = false
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      let ready = false
      const fail = (why: string) => {
        if (!ready) reject(new Error(why))
      }
      ws.onerror = () => fail("Couldn't open the connection to Hermes")
      ws.onclose = (e) => {
        this.stop()
        if (!ready) fail(e.reason || `Connection closed (${e.code})`)
        else if (!this.closedByUs) this.onClose(e.reason || `closed (${e.code})`)
      }
      ws.onmessage = (m) => {
        this.lastHeard = Date.now()
        let frame: any
        try {
          frame = JSON.parse(String(m.data))
        } catch {
          return
        }
        if (frame.method === "event") {
          const ev = frame.params as GatewayEvent
          if (ev.type === "gateway.ready" && !ready) {
            ready = true
            this.replayEpoch = ev.payload?.replay_epoch ?? null
            this.startHeartbeat()
            // Without this the server fails approvals/clarify for our socket.
            this.call("client.capabilities", { server_requests: true }).catch(() => {})
            resolve()
            return
          }
          this.onEvent(ev)
          return
        }
        if (frame.method && frame.id !== undefined) {
          this.onRequest({ id: frame.id, method: frame.method, params: frame.params })
          return
        }
        if (frame.id !== undefined) {
          const p = this.pending.get(frame.id)
          if (!p) return
          this.pending.delete(frame.id)
          clearTimeout(p.timer)
          if (frame.error) p.reject(new RpcError(frame.error.message ?? "Request failed", frame.error.code))
          else p.resolve(frame.result)
        }
      }
    })
  }

  call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Not connected to Hermes"))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    })
  }

  /** Answer a server→client request (approval, clarify, …). */
  respond(id: string, result: unknown) {
    this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id, result }))
  }

  respondError(id: string, code: number, message: string) {
    this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }))
  }

  close() {
    this.closedByUs = true
    this.stop()
    this.ws?.close()
    this.ws = null
  }

  private startHeartbeat() {
    this.lastHeard = Date.now()
    this.ping = setInterval(() => {
      if (Date.now() - this.lastHeard > 45_000) {
        this.ws?.close(4000, "heartbeat timeout")
        return
      }
      this.call("gateway.ping", {}, 15_000).catch(() => {})
    }, 15_000)
  }

  private stop() {
    clearInterval(this.ping)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error("Connection to Hermes closed"))
    }
    this.pending.clear()
  }
}
