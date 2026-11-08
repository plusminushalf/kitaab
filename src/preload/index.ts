import { contextBridge, ipcRenderer, webUtils } from "electron"
import type {
  ConnectionResult,
  FileText,
  HermesBridge,
  Settings,
  SetupResult,
  SetupStep,
  SetupTarget,
  ThemeSearchSort,
  UpdateState,
} from "../shared/bridge"

const api: HermesBridge = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
    set: (s: Settings): Promise<Settings> => ipcRenderer.invoke("settings:set", s),
  },
  setup: {
    needed: (): Promise<boolean> => ipcRenderer.invoke("setup:needed"),
    sshHosts: (): Promise<string[]> => ipcRenderer.invoke("setup:sshHosts"),
    check: async (target: SetupTarget, onProgress: (steps: SetupStep[]) => void): Promise<SetupResult> => {
      const h = (_: unknown, steps: SetupStep[]) => onProgress(steps)
      ipcRenderer.on("setup:progress", h)
      try {
        return await ipcRenderer.invoke("setup:check", target)
      } finally {
        ipcRenderer.off("setup:progress", h)
      }
    },
  },
  connection: {
    open: (): Promise<ConnectionResult> => ipcRenderer.invoke("connection:open"),
    close: (): Promise<void> => ipcRenderer.invoke("connection:close"),
  },
  auth: {
    signIn: (): Promise<void> => ipcRenderer.invoke("auth:signIn"),
    signOut: (): Promise<void> => ipcRenderer.invoke("auth:signOut"),
  },
  server: {
    restart: (): Promise<void> => ipcRenderer.invoke("server:restart"),
  },
  files: {
    quickLook: (path: string, name: string): Promise<void> => ipcRenderer.invoke("files:quickLook", path, name),
    read: (path: string): Promise<FileText> => ipcRenderer.invoke("files:read", path),
  },
  api: {
    get: <T,>(path: string): Promise<T> => ipcRenderer.invoke("api:get", path),
    put: <T,>(path: string, body: unknown): Promise<T> => ipcRenderer.invoke("api:put", path, body),
    post: <T,>(path: string, body: unknown): Promise<T> => ipcRenderer.invoke("api:post", path, body),
  },
  window: {
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window:isFullscreen"),
    onFullscreen: (cb: (value: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v)
      ipcRenderer.on("window:fullscreen", h)
      return () => void ipcRenderer.off("window:fullscreen", h)
    },
  },
  appearance: {
    setScheme: (scheme) => ipcRenderer.send("appearance:scheme", scheme),
    systemDark: (): Promise<boolean> => ipcRenderer.invoke("appearance:systemDark"),
    onSystemDark: (cb: (dark: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v)
      ipcRenderer.on("appearance:systemDark", h)
      return () => void ipcRenderer.off("appearance:systemDark", h)
    },
  },
  themes: {
    search: (query: string, sort: ThemeSearchSort) => ipcRenderer.invoke("themes:search", query, sort),
    install: (namespace: string, name: string) => ipcRenderer.invoke("themes:install", namespace, name),
    export: (fileName: string, contents: string) => ipcRenderer.invoke("themes:export", fileName, contents),
  },
  fonts: () => ipcRenderer.invoke("fonts:list"),
  onMenu: (cb: (command: string) => void) => {
    const h = (_: unknown, c: string) => cb(c)
    ipcRenderer.on("menu", h)
    return () => void ipcRenderer.off("menu", h)
  },
  dock: {
    badge: (count: number) => ipcRenderer.send("app:badge", count),
    bounce: () => ipcRenderer.send("app:bounce"),
  },
  /** Absolute path of a dropped File (Electron removed File.path). */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  updates: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke("update:get"),
    check: (): Promise<UpdateState> => ipcRenderer.invoke("update:check"),
    download: (): Promise<UpdateState> => ipcRenderer.invoke("update:download"),
    install: (): Promise<boolean> => ipcRenderer.invoke("update:install"),
    acknowledge: () => ipcRenderer.send("update:acknowledge"),
    onState: (cb: (state: UpdateState) => void) => {
      const h = (_: unknown, v: UpdateState) => cb(v)
      ipcRenderer.on("update:state", h)
      return () => void ipcRenderer.off("update:state", h)
    },
  },
}

contextBridge.exposeInMainWorld("hermes", api)
