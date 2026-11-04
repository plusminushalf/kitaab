import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ConnectionResult, FileText, HermesBridge, Settings, ThemeSearchSort } from "../shared/bridge"

const api: HermesBridge = {
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke("settings:get"),
    set: (s: Settings): Promise<Settings> => ipcRenderer.invoke("settings:set", s),
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
}

contextBridge.exposeInMainWorld("hermes", api)
