// The API the preload script exposes to the renderer as `window.hermes`.

export type Settings = {
  /** SSH host (an alias from ~/.ssh/config works). Empty means use baseUrl. */
  sshHost: string
  /** An existing Hermes dashboard, used when sshHost is empty. */
  baseUrl: string
}

import type { ConnectionResult } from "@kitab/core/platform"
export type { ConnectionResult }

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

/** Where the app updater is. Mirrors T3 Code's flow: check → download → restart to install. */
export type UpdateStatus =
  | "disabled" // running from source, or from a place it can't replace itself
  | "idle" // hasn't checked yet
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error"

/** One release between the running version and the newest, for the "what's new" card. */
export type ReleaseNote = { version: string; publishedAt: string | null; url: string; body: string }

export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  /** Newest release the signed feed offers, when it's newer than this app. */
  availableVersion: string | null
  /** A verified copy of this version is staged and installs on restart. */
  downloadedVersion: string | null
  downloadPercent: number | null
  /** ms since epoch of the last finished check. */
  checkedAt: number | null
  /** Why updates are off, or what went wrong. */
  message: string | null
  errorContext: "check" | "download" | "install" | null
  /** Newest first; empty when GitHub couldn't be reached for notes. */
  releaseNotes: ReleaseNote[]
  /** An update that was installed but the app came back on the old version. */
  notAppliedVersion: string | null
  /** Set once, on the first launch after an update succeeded. */
  justUpdatedFrom: string | null
}

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
    /** JSON PUT; only /api/config and /api/skills/{toggle,content} are allowed. */
    put<T = unknown>(path: string, body: unknown): Promise<T>
    /** JSON POST; only /api/skills (create a skill) is allowed. */
    post<T = unknown>(path: string, body: unknown): Promise<T>
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
  updates: {
    get(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    /** Asks to confirm, then quits, swaps the app and reopens it. false if cancelled or refused. */
    install(): Promise<boolean>
    /** Clears justUpdatedFrom once the renderer has shown it. */
    acknowledge(): void
    onState(cb: (state: UpdateState) => void): () => void
  }
}
