import { app, Menu, shell, type MenuItemConstructorOptions } from "electron"

import type { ShortcutId } from "../shared/shortcuts"

type Send = (channel: string, ...args: unknown[]) => void

// Native menu bar. Commands the renderer handles are sent as "menu:<command>".
// Bindings come from Settings → Shortcuts; `paused` drops them while one is being
// recorded, so pressing the old combination records it instead of running it.
export function installMenu(send: Send, bindings: Record<ShortcutId, string>, paused = false) {
  const isDev = !app.isPackaged
  const item = (label: string, id: ShortcutId): MenuItemConstructorOptions => ({
    label,
    ...(bindings[id] && !paused ? { accelerator: bindings[id] } : {}),
    click: () => send("menu", id),
  })
  const cmd = (command: string) => () => send("menu", command)

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: cmd("check-updates") },
        { type: "separator" },
        item("Settings…", "settings"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        item("New Thread", "new-thread"),
        item("Commands…", "command-palette"),
        item("Mark Thread as Done", "mark-done"),
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find",
          submenu: [
            item("Find in Thread…", "find"),
            item("Find Next", "find-next"),
            item("Find Previous", "find-previous"),
          ],
        },
        { type: "separator" },
        {
          label: "Speech",
          submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
        },
      ],
    },
    {
      label: "View",
      submenu: [
        item("Toggle Sidebar", "toggle-sidebar"),
        { type: "separator" },
        item("Back", "back"),
        item("Forward", "forward"),
        { type: "separator" },
        // ⌘1–⌘9 switch profiles (handled in the renderer), so the views default to ⌥⌘.
        item("Threads", "go-threads"),
        item("Routines", "go-routines"),
        item("Personalities", "go-personalities"),
        item("Profile Settings", "go-profile"),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev
          ? ([{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Hermes Agent Documentation",
          click: () => void shell.openExternal("https://hermes-agent.nousresearch.com/docs"),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
