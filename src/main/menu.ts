import { app, Menu, shell, type MenuItemConstructorOptions } from "electron"

type Send = (channel: string, ...args: unknown[]) => void

// Native menu bar. Commands the renderer handles are sent as "menu:<command>".
export function installMenu(send: Send) {
  const cmd = (command: string) => () => send("menu", command)
  const isDev = !app.isPackaged

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "Cmd+,", click: cmd("settings") },
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
        { label: "New Thread", accelerator: "Cmd+N", click: cmd("new-thread") },
        { label: "Mark Thread as Done", accelerator: "Cmd+Shift+S", click: cmd("mark-done") },
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
        { label: "Find…", accelerator: "Cmd+K", click: cmd("find") },
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
        { label: "Toggle Sidebar", accelerator: "Cmd+B", click: cmd("toggle-sidebar") },
        { type: "separator" },
        { label: "Back", accelerator: "Cmd+[", click: cmd("back") },
        { label: "Forward", accelerator: "Cmd+]", click: cmd("forward") },
        { type: "separator" },
        { label: "Threads", accelerator: "Cmd+1", click: cmd("go-threads") },
        { label: "Routines", accelerator: "Cmd+2", click: cmd("go-routines") },
        { label: "Personalities", accelerator: "Cmd+3", click: cmd("go-personalities") },
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
