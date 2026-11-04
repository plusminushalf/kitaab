// What the shared core needs from the app it runs in. The Mac app and the iPhone app
// each install one at startup with setPlatform(); nothing in the core touches
// `window`, the DOM, Electron or React Native directly.

export type ConnectionResult =
  | {
      ok: true
      wsUrl: string
      label: string
      version?: string
      /** For loading server files directly (images, video): `${base}/api/files/download?path=…&token=…`. */
      files?: { base: string; token: string }
    }
  | { ok: false; needsSignIn: boolean; message: string }

export type NoticeKind = "info" | "success" | "warning" | "error"
export type NoticeOptions = { id?: string; action?: { label: string; onClick: () => void } }

export interface Platform {
  /** Opens (or reuses) the way to the server and returns a ready-to-use WebSocket URL. */
  connect(): Promise<ConnectionResult>
  /** Authenticated Hermes REST calls; `path` starts with /api/. */
  http: {
    get<T = unknown>(path: string): Promise<T>
    put<T = unknown>(path: string, body: unknown): Promise<T>
    post<T = unknown>(path: string, body: unknown): Promise<T>
  }
  notify(kind: NoticeKind, message: string, options?: NoticeOptions): void
  dismiss(id: string): void
  confirm(message: string): Promise<boolean>
  /** Something finished or needs the user. Ignored when the app is in front. */
  attention(): void
  /** Small synchronous key/value store for this device only. */
  storage: { get(key: string): string | null; set(key: string, value: string | null): void }
  /** Bytes behind an attachment's url, base64-encoded. */
  base64(url: string): Promise<string>
}

let current: Platform | null = null

export function setPlatform(p: Platform) {
  current = p
}

export function platform(): Platform {
  if (!current) throw new Error("Kitab core used before setPlatform()")
  return current
}

/** sonner-shaped helper so the core reads the same as before. */
export const toast = Object.assign((message: string, options?: NoticeOptions) => platform().notify("info", message, options), {
  success: (m: string, o?: NoticeOptions) => platform().notify("success", m, o),
  warning: (m: string, o?: NoticeOptions) => platform().notify("warning", m, o),
  error: (m: string, o?: NoticeOptions) => platform().notify("error", m, o),
  dismiss: (id: string) => platform().dismiss(id),
})

export const http = () => platform().http
