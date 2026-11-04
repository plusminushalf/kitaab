// The API the preload script exposes to the renderer as `window.hermes`.

export type Settings = {
  /** SSH host (an alias from ~/.ssh/config works). Empty means use baseUrl. */
  sshHost: string
  /** An existing Hermes dashboard, used when sshHost is empty. */
  baseUrl: string
}

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

/** A server file's contents for the side panel; text is null for binary files. */
export type FileText = { text: string | null; size: number; truncated: boolean }

/** A theme extension on Open VSX (open-vsx.org), as shown in "Add a theme". */
export type ThemeExtension = {
  namespace: string
  name: string
  displayName: string
  description?: string
  version?: string
  downloadCount?: number
  averageRating?: number
  iconUrl?: string
}

/** One color theme from an installed extension: the raw (JSONC) theme file. */
export type ExtensionTheme = { label: string; uiTheme?: string; json: string }

export type ThemeSearchSort = "relevance" | "downloadCount" | "averageRating" | "timestamp"

export type HermesBridge = {
  settings: {
    get(): Promise<Settings>
    set(s: Settings): Promise<Settings>
  }
  connection: {
    /** Opens the tunnel if needed and returns a ready-to-use WebSocket URL. */
    open(): Promise<ConnectionResult>
    close(): Promise<void>
  }
  auth: {
    signIn(): Promise<void>
    signOut(): Promise<void>
  }
  server: {
    /** Stops the app's private Hermes backend on the SSH host. */
    restart(): Promise<void>
  }
  api: {
    get<T = unknown>(path: string): Promise<T>
    /** JSON PUT; only /api/config is allowed. */
    put<T = unknown>(path: string, body: unknown): Promise<T>
  }
  files: {
    /** Downloads a file from the server and opens it in Quick Look. */
    quickLook(path: string, name: string): Promise<void>
    /** Reads a server file as UTF-8 text (first 5 MB). */
    read(path: string): Promise<FileText>
  }
  window: {
    isFullscreen(): Promise<boolean>
    onFullscreen(cb: (value: boolean) => void): () => void
  }
  appearance: {
    /** Tells macOS which appearance the window uses (vibrancy, traffic lights, menus). */
    setScheme(scheme: "system" | "light" | "dark"): void
  }
  themes: {
    search(query: string, sort: ThemeSearchSort): Promise<ThemeExtension[]>
    /** Downloads an extension and returns its color themes. */
    install(namespace: string, name: string): Promise<{ displayName: string; themes: ExtensionTheme[] }>
    /** Saves a theme file through the macOS save panel. */
    export(fileName: string, contents: string): Promise<boolean>
  }
  /** Font families installed on this Mac. */
  fonts(): Promise<{ family: string; monospace: boolean }[]>
  onMenu(cb: (command: string) => void): () => void
  dock: {
    badge(count: number): void
    bounce(): void
  }
  /** Absolute path of a dropped File (Electron removed File.path). */
  pathForFile(file: File): string
}
