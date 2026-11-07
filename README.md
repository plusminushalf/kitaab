<p align="center">
  <img src="resources/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">Kitaab</h1>

<p align="center">A small macOS and iPhone client for a <a href="https://hermes-agent.nousresearch.com/docs">Hermes Agent</a> server.</p>

Kitaab connects to a Hermes install on another machine, usually over SSH, and organizes your work into **projects**, **threads**, **routines** and **personalities**. It never installs or updates Hermes; it only talks to it.

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

**SSH (recommended).** Enter a host or an alias from `~/.ssh/config`. Kitaab starts its own private `hermes serve --isolated` on that machine, bound to loopback with a session token it creates, and reaches it through an SSH tunnel. The backend keeps running after you quit and is reused on the next launch. No login is needed, because SSH access is the credential.

- `hermes` must be on the remote `PATH` (or in `~/.local/bin`).
- Your SSH key must be loaded in the agent. Kitaab runs `ssh` in batch mode and can't answer a passphrase prompt.

**Dashboard URL.** Leave the SSH host empty and point Kitaab at an existing Hermes dashboard, such as `http://127.0.0.1:9119`. If the dashboard requires login, Kitaab opens your browser to sign in (OAuth with PKCE) and never sees your password.

**The Mac and the iPhone share one backend.** Kitaab keeps a private copy of the backend's session token next to its lockfile on the server (`~/.hermes/desktop-ssh/<id>/kitab-token`, mode 600), so whichever device connects next finds the running backend and joins it instead of starting another. Every device picks the oldest live one, so they converge, and a device that joins someone else's backend stops the one it left behind. Because they share a backend, a reply streaming on one device streams on the other, and approvals show up on both. What Kitaab adds on top of Hermes (which personalities are in a thread, who answered each turn, which routine runs became threads) is saved on the server in each project's profile, never on one device.

Tokens are stored encrypted with the macOS keychain. Kitaab keeps its settings in `~/Library/Application Support/hermes-desktop`, separate from the official Hermes app.

## iPhone

The iPhone app (`apps/mobile`) has the same projects, threads, routines and personalities, and connects the same way, over SSH, from inside the app:

1. Open **Settings** in the app and enter the host, your user name and the port. Use an address the phone can reach, such as a Tailscale name.
2. Copy **This iPhone's key** (an Ed25519 key made on the phone and kept in its Keychain) and add it to `~/.ssh/authorized_keys` on the host.
3. Tap **Connect**. The first time, Kitaab trusts the host's key and shows its fingerprint. After that it refuses a host that shows a different key.

To run it from source (needs Xcode):

```sh
cd apps/mobile
pnpm install
pnpm ios          # builds the dev client and runs it in the simulator
pnpm start        # Metro, for an already-installed dev client
```

It uses native modules, so it can't run in Expo Go. A real iPhone needs your Apple team set for signing in Xcode.

## Requirements

- macOS. Kitaab doesn't try to be cross-platform.
- Node.js 24 and pnpm 10.
- A machine running [Hermes Agent](https://hermes-agent.nousresearch.com/docs).

## Install

On an Apple silicon Mac:

```sh
curl -fsSL https://raw.githubusercontent.com/plusminushalf/kitaab/main/install.sh | bash
```

This installs the latest release into `/Applications` and opens it. Set `KITAAB_VERSION=0.1.0` before `bash` to install a specific release. The installer verifies the release signature and the DMG's SHA-256 before installing anything (see below).

Kitaab isn't notarized by Apple. An app downloaded with `curl` opens without a Gatekeeper prompt. A DMG downloaded in a browser is blocked the first time it opens: allow it in System Settings → Privacy & Security, or run `xattr -dr com.apple.quarantine /Applications/Kitaab.app`.

### Verifying a download

Each release has a `SHA256SUMS` file with the DMG's hash, signed with Kitaab's release key. The public key is [`release-key.pub`](release-key.pub):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIKSxxZ9QRwqldlKJi68n/FSXG32Hpy8JCzYGIDVPSGo
```

To check a DMG by hand, put it in a folder with that release's `SHA256SUMS` and `SHA256SUMS.sig`, then run:

```sh
echo "kitab-release $(curl -fsSL https://raw.githubusercontent.com/plusminushalf/kitaab/main/release-key.pub)" > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I kitab-release -n kitab-release -s SHA256SUMS.sig < SHA256SUMS
shasum -a 256 -c SHA256SUMS
```

The first command should print `Good "kitab-release" signature`, the second `Kitaab-<version>-arm64.dmg: OK`. Both tools ship with macOS.

### Updates

Kitaab updates itself from GitHub releases. About 15 seconds after launch, and every 30 minutes after that, it downloads the latest release's `SHA256SUMS` and checks its signature against the same pinned release key. If that names a newer DMG, a download button appears at the bottom of the sidebar. Hover it to see what's new, and click it to download. When the download is done, the button turns into a restart arrow. Click it, confirm, and Kitaab quits, replaces itself and reopens. **Kitaab → Check for Updates…** and Settings → General check right away.

Before staging an update, Kitaab checks that the DMG matches its signed SHA-256, that the app inside has Kitaab's bundle id, that its version is the one the signed file names, and that its code signature is intact. It only ever moves forward a version. If the folder Kitaab is in isn't writable by you, macOS asks for an administrator password when installing. If an update doesn't take, the next launch says so.

Updates are off when Kitaab runs from source, from a disk image, or from a quarantined copy macOS hasn't moved (move it to Applications first). Releases up to 0.1.1 have no updater, so anyone on one of those needs to reinstall once with the `curl` command above.

Kitaab doesn't use electron-updater, because its Mac half (Squirrel.Mac) only accepts updates signed with an Apple Developer ID and Kitaab is ad-hoc signed. See `src/main/updater.ts`.

## Development

```sh
pnpm install
pnpm dev          # run with hot reload
pnpm typecheck
```

`pnpm dev` runs a private copy of Electron renamed to Kitaab (in `node_modules/.kitab-electron`), so the menu bar and Dock show the right name and icon.

## Building the app

```sh
pnpm package      # builds dist/Kitaab.app
pnpm install-app  # builds it and replaces /Applications/Kitaab.app
```

The app is ad-hoc signed, which is enough to run it on the Mac that built it. It isn't notarized, so Gatekeeper will block a copy moved to another Mac. Build it on each Mac instead.

## Releasing

```sh
pnpm dmg          # builds dist/Kitaab-<version>-<arch>.dmg
```

Pushing a tag like `v0.1.0` runs `.github/workflows/dmg.yml`. It builds the DMG with that version, writes `SHA256SUMS`, signs it with `scripts/sign-release.sh`, and attaches all three files to a GitHub release. The release notes open with a "What's new" list of commit subjects since the previous tag, which the app shows in its update card. Installed copies pick the release up within about 30 minutes. You can also run the workflow by hand from the Actions tab, which uploads the files as a workflow artifact instead.

To ship an update, push a tag higher than the last release; package.json stays as it is (`git tag v0.2.0 && git push origin v0.2.0`).

The release key's private half is the `RELEASE_SIGNING_KEY` repository secret, and tagged builds fail without it. If you ever replace the key, update `release-key.pub`, `PUBLIC_KEY` in `install.sh` and `PUBLIC_KEY` in `src/main/updater.ts` in the same commit. Releases signed with the old key will no longer verify against the new one, and installed apps only trust the key they shipped with, so they need one release signed with the old key that carries the new one.

To sign and notarize the app with Apple, so it opens on any Mac with no Gatekeeper prompt, add these repository secrets: `APPLE_CERTIFICATE_P12` (a base64-encoded Developer ID Application certificate), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Without them the DMG is ad-hoc signed, and people who download it have to allow it in System Settings → Privacy & Security the first time they open it.

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
packages/core/  the Hermes logic both apps share: gateway client, adapter, personalities,
                skills, thread details, the SSH backend scripts
src/main/       Electron main process: SSH backend, tunnel, sign-in, menus, themes
src/preload/    the bridge exposed to the renderer
src/renderer/   React UI (Tailwind, shadcn on Base UI)
src/shared/     types shared by both sides
apps/mobile/    the iPhone app (Expo, React Native); modules/kitab-ssh is its SSH client
docs/           product concept and research notes
```

Both apps speak JSON-RPC to Hermes over a plain WebSocket (`/api/ws`). `packages/core/src/backend.ts` translates Hermes data into the app's own vocabulary, so Hermes terms don't leak into the UI. The core has no dependencies and never touches Electron, React Native or the DOM: each app hands it a small `Platform` (`packages/core/src/platform.ts`) for HTTP, notices, prompts and storage, and imports it as `@kitab/core/<module>`. The iPhone app's SSH client (`apps/mobile/modules/kitab-ssh`) is built on Apple's swift-nio-ssh. It sends scripts on stdin, so the token never shows up in the remote process list.

## License

[MIT](LICENSE)
