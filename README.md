<p align="center">
  <img src="resources/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">Kitab</h1>

<p align="center">A small macOS client for a <a href="https://hermes-agent.nousresearch.com/docs">Hermes Agent</a> server.</p>

Kitab connects to a Hermes install on another machine, usually over SSH, and organizes your work into **projects**, **threads**, **routines** and **personalities**. It never installs or updates Hermes; it only talks to it.

## How it's organized

```
Server   your Hermes, running somewhere
 └─ Project        memory · skills · files          (a Hermes profile)
     ├─ Threads        parallel conversations          (Hermes sessions)
     ├─ Routines       scheduled work, one report per run (Hermes cron jobs)
     └─ Personalities  the cast you talk to
```

- **Threads** are for thinking: one conversation, one line of work. Run several in parallel.
- **Routines** are for repeat work. Each run produces a report. Reply to a run and it becomes a thread you can come back to.
- **Facts belong to the project, craft belongs to the personality.**

See [`docs/product/concept.md`](docs/product/concept.md) for the full model.

## Connecting to Hermes

Open **Settings** (`⌘,`) and pick one of two ways in:

**SSH (recommended).** Enter a host or an alias from `~/.ssh/config`. Kitab starts its own private `hermes serve --isolated` on that machine, bound to loopback with a session token it creates, and reaches it through an SSH tunnel. The backend keeps running after you quit and is reused on the next launch. No login is needed, because SSH access is the credential.

- `hermes` must be on the remote `PATH` (or in `~/.local/bin`).
- Your SSH key must be loaded in the agent. Kitab runs `ssh` in batch mode and can't answer a passphrase prompt.

**Dashboard URL.** Leave the SSH host empty and point Kitab at an existing Hermes dashboard, such as `http://127.0.0.1:9119`. If the dashboard requires login, Kitab opens your browser to sign in (OAuth with PKCE) and never sees your password.

Tokens are stored encrypted with the macOS keychain. Kitab keeps its settings in `~/Library/Application Support/hermes-desktop`, separate from the official Hermes app.

## Requirements

- macOS. Kitab doesn't try to be cross-platform.
- Node.js 24 and pnpm 10.
- A machine running [Hermes Agent](https://hermes-agent.nousresearch.com/docs).

## Development

```sh
pnpm install
pnpm dev          # run with hot reload
pnpm typecheck
```

`pnpm dev` runs a private copy of Electron renamed to Kitab (in `node_modules/.kitab-electron`), so the menu bar and Dock show the right name and icon.

## Building the app

```sh
pnpm package      # builds dist/Kitab.app
pnpm install-app  # builds it and replaces /Applications/Kitab.app
```

The app is ad-hoc signed, which is enough to run it on the Mac that built it. It isn't notarized, so Gatekeeper will block a copy moved to another Mac. Build it on each Mac instead.

## Shortcuts

| | |
|---|---|
| `⌘N` | New thread |
| `⌘⇧S` | Mark thread as done |
| `⌘K` | Find |
| `⌘B` | Toggle sidebar |
| `⌘1` `⌘2` `⌘3` | Threads, Routines, Personalities |
| `⌘[` `⌘]` | Back, forward |
| `⌘,` | Settings |

## Themes

Settings → Appearance has built-in light and dark themes, a theme editor, and VS Code themes installed straight from [Open VSX](https://open-vsx.org).

## Project layout

```
src/main/       Electron main process: SSH backend, tunnel, sign-in, menus, themes
src/preload/    the bridge exposed to the renderer
src/renderer/   React UI (Tailwind, shadcn on Base UI)
src/shared/     types shared by both sides
docs/           product concept and research notes
```

The renderer speaks JSON-RPC to Hermes over a plain WebSocket (`/api/ws`). `src/renderer/src/lib/backend.ts` translates Hermes data into the app's own vocabulary, so Hermes terms don't leak into the UI.

## License

[MIT](LICENSE)
