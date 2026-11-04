import { app, screen, type BrowserWindow, type Rectangle } from "electron"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const file = () => join(app.getPath("userData"), "window-state.json")

export function restoreWindowState(): Partial<Rectangle> {
  const fallback = { width: 1180, height: 780 }
  if (!existsSync(file())) return fallback
  try {
    const saved = JSON.parse(readFileSync(file(), "utf8")) as Rectangle
    // Only restore the position if it's still on a connected display.
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.x >= a.x && saved.y >= a.y && saved.x < a.x + a.width && saved.y < a.y + a.height,
    )
    return visible ? saved : { width: saved.width, height: saved.height }
  } catch {
    return fallback
  }
}

export function trackWindowState(win: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen()) writeFileSync(file(), JSON.stringify(win.getNormalBounds()))
    }, 400)
  }
  win.on("resize", save)
  win.on("move", save)
}
