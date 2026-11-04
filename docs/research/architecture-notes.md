# Architecture research: T3 Code, Herdr, and Hermes itself

Researched 2026-11-02. Sources: T3 Code `pingdotgg/t3code` @ `55e25385`, Herdr `herdrdev/herdr` @ `ee5bfb5` (v0.9.5), Hermes Agent v0.22.5 installed at `~/.hermes/hermes-agent`.

## The most important finding: Hermes already has a backend protocol

We don't need to write an agent backend. Hermes ships two machine interfaces:

1. **`tui_gateway`**: newline-delimited JSON-RPC, over stdio or WebSocket. The Ink TUI (`hermes --tui`), the official Desktop app and the dashboard `/chat` page all use it (`tui_gateway/AGENTS.md`).
   - Client→server method calls. Server→client *requests* when the agent needs the user: `approval`, `clarify`, `sudo`, `secret`, … Server→client `event` notifications.
   - On reconnect, `session.resume` and `session.events.since` replay events and any questions still waiting for an answer.
   - The contract is declared in Pydantic (`tui_gateway/contracts/`) and **generated into TypeScript**: `apps/shared/src/gateway-contract.generated.ts` (7.3k lines, `RpcMethods`, `ServerRequestMap`, `BackendGatewayEventMap`) plus `gateway-contract.openrpc.json`. There is a ready-made client in `apps/shared/src/json-rpc-gateway.ts`.
   - The official desktop finds or attaches to a `hermes dashboard` / `serve` backend and talks to it over WS at `/api/ws` (`apps/desktop/electron/backend-discovery.ts`).
2. **`acp_adapter/`**: Hermes speaks ACP (Agent Client Protocol). Any ACP client can drive it, which includes T3 Code as a "Local ACP command". ACP is generic, so it exposes less Hermes-specific surface than tui_gateway.

The official desktop uses **the same stack as T3 Code**: Electron 44, React 19.2, Tailwind 4.3, Vite 8. That makes the bloat a product-scope problem, not a technology problem: ~1,190 `.tsx` files in `src/` and ~608 files in `electron/` alone.

## T3 Code

### Stack
- **Electron 44.10** with electron-builder and electron-updater (not Tauri).
- **React 19.3** with React Compiler. Lint bans manual `useMemo`/`useCallback`.
- **TanStack Router**, file-based (`apps/web/src/routes/_chat.$environmentId.$threadId.tsx`).
- **State:** Effect atoms for domain and connection state; zustand for local UI stores (`rightPanelStore`, `composerDraftStore`).
- **UI:** Tailwind 4 with semantic CSS-variable tokens (`apps/web/src/index.css`). shadcn-style primitives on `@base-ui/react`, cva, lucide, Inter.
- **Composer and rendering:** Tiptap 3 composer, `@pierre/diffs` for diffs, `@legendapp/list` for the virtualized timeline, incremental markdown streaming.
- **Effect-TS 4** everywhere: RPC, SQL, Schema, Layers.
- **Tooling:** Vite+ (`vp`), tsc-rs, pnpm 12, oxlint.

### Process model
- `apps/server` is a Node HTTP/WS server, published as `npx t3`. It owns providers, PTYs (node-pty), git and SQLite.
- `apps/desktop` spawns that server as a child process (`ELECTRON_RUN_AS_NODE=1`, bootstrap JSON on fd3; see `DesktopBackendManager.ts`).
- The renderer is just another WebSocket RPC client, with no special IPC path. Electron IPC is used only for shell features: windows, updates, notifications. That split is why web, mobile and remote work almost for free.
- **Contract:** `packages/contracts/src/rpc.ts` holds typed `Rpc.make` definitions. Streams are RPCs with `stream: true`, and commands go through one `dispatchCommand`.
- **Sync:** each subscription sends a snapshot with `snapshotSequence`, then events with `sequence > N`.
  - `subscribeShell` sends the sidebar summary of all threads. `subscribeThread` sends the detail of one thread.
  - Token deltas are coalesced on the server in 50 ms windows (`ThreadLiveEventCoalescer.ts`).

### Providers
- **`ProviderAdapterV2`** (`packages/provider-core/src/server/ProviderAdapter.ts`) opens a `SessionRuntime` with:
  - `events: Stream<…>`
  - `startTurn` / `steerTurn` / `interruptTurn`
  - `respondToRuntimeRequest`
  - `rollback` / `fork`
- **Normalized event union:** `message.updated`, `turn_item.updated`, `runtime_request.updated` (approvals), `plan.updated`, `turn.terminal`, …
- **Turn items** are a discriminated union: `assistant_message`, `reasoning`, `command_execution`, `file_change`, `approval_request`, `proposed_plan`, `todo_list`, … The UI renders only this union.
- **Capability flags** control features. No `if provider === …` anywhere.
- **Generic ACP adapter** (`packages/provider-acp`) with a small per-agent "flavor" hook object for quirks.

### Persistence
- SQLite through `node:sqlite` in WAL mode, at `userdata/statev2.sqlite`.
- Event sourcing with an outbox: Orchestrator → EventSink (events, projections and receipt in one transaction) → EffectWorker for side effects.
- Per-turn checkpoints are stored as hidden git refs (`refs/t3/...`), and diffs are derived from them.

### UI layout
- Resizable thread sidebar.
- Main area: ChatHeader, then the virtualized `MessagesTimeline`, then the composer.
- Tool calls are collapsed into "work groups" with timers.
- Approvals appear inline as rows. Plans render as cards.
- Right panel tabs: diff, files, preview, terminal, PR.
- Bottom terminal drawer and a command palette.
- "Clean" is enforced by lint: primitives can't be restyled through `className` (only variants), slot composition, no continuously repainting animations.

### Steal / avoid
- **Steal:**
  - Local server as a child process, with the renderer as a plain WS client.
  - One typed contract package.
  - Snapshot + sequence-cursor streams, split into a shell stream and a thread stream.
  - Normalized turn-item union.
  - Capability flags.
  - Hidden-git-ref checkpoints.
  - Base UI + Tailwind tokens with a variants-only discipline.
  - Virtualized timeline and incremental markdown.
  - A replay/fake provider for UI development.
- **Avoid for v1:**
  - Effect at full depth.
  - The full orchestration-v2 graph (Runs, ExecutionNodes, handoffs).
  - 11 provider drivers.
  - The relay, auth, SSH/WSL backends and the mobile app.
  - Bleeding-edge tooling (Vite+, tsc-rs).

## Herdr

### Stack
- A single Rust binary.
- ratatui 0.30 and crossterm for UI. tokio. `interprocess` for local sockets.
- Vendored **libghostty-vt** for terminal emulation (`crates/ghostty-vt`), and a vendored, patched `portable-pty`.
- **Design rules:**
  - State is separate from runtime (`AppState` holds only data).
  - Render is pure.
  - Agent detection reads only a screen snapshot.

### Process model
- `herdr server` is a headless daemon that owns every PTY. The `herdr` client attaches and detaches.
- **Two sockets:**
  - `herdr.sock`: public NDJSON API.
  - `herdr-client.sock`: private bincode protocol, `PROTOCOL_VERSION = 22`.
- **The client draws its own chrome** (sidebar, tabs, menus) from a `ClientShellSnapshot`. The server streams only pane surfaces.
- **Versioned endpoint contract:**
  - New fields must be optional.
  - New enum values need an `Unknown` fallback.
  - Capability negotiation: a missing capability disables one action, not the whole connection.
- **Update handoff:** PTY file descriptors are passed to the new server over SCM_RIGHTS, so running agents survive an upgrade.

### Domain model
- Workspace → Tab → Pane. A tab's layout is a BSP tree of splits.
- `TerminalState` holds all agent facts: detected agent, state, session id, resume argv, metadata.
- `PaneState` is just `{terminal_id, seen}`.

### Agent status model (the best idea here)
- **States:** `idle | working | blocked | unknown`, plus `done = idle && !seen`.
- **Signals are layered:**
  1. Identify the process: walk the foreground process group.
  2. Read screen and OSC-title manifests (hot-reloadable TOML rules, debounced).
  3. Accept authoritative integration hook reports, with a monotonic `seq` per source.
- **Attention rollup** from pane to tab to workspace: blocked > done > working > idle > unknown.
- **The Hermes integration today** (`herdr integration install hermes`):
  - Installs a Hermes plugin at `~/.hermes/plugins/herdr-agent-state/`.
  - Hooks `on_session_start`, `on_session_reset` and `pre_llm_call`.
  - Reports only the session id. State comes from the screen: OSC title glyphs `⚠` blocked, `⏳` working, `✓` idle (`src/detect/manifests/hermes.toml`).
  - Resume command: `hermes --resume <id>`.

### Socket API
- NDJSON `{id, method, params}`, with a schema generated from Rust types. The CLI flags and the API params come from one definition.
- `agent.prompt` can take a built-in `wait{until, timeout_ms}`, so sending a prompt and waiting on it can't race.
- **Sync model:**
  - `events.subscribe`, then `session.snapshot`.
  - Events are invalidation signals.
  - A 512-entry ring buffer; `events_lost` means the client must resync.
- Display metadata (title, labels, tokens with a TTL) is kept separate from semantic state.

### Persistence (layered restore)
In order of strength:
1. Live detach.
2. Upgrade handoff.
3. Native agent resume (validated argv).
4. Optional screen history replay.
5. Layout snapshot.

Supporting details:
- Rotating snapshots: 48 max, at most one per 15 minutes.
- A pane whose restore fails keeps its place in the layout and shows an error.

### UI
- Sidebar with a Spaces section above an Agents section.
- Configurable row tokens with style rules.
- Status icons: ● ○ ◐ ✓ ×. Default colours: red blocked, yellow working, green done, blue unseen.
- 18 themes as semantic palettes.
- Notifications: suppressed for the active tab, with separate "needs attention" and "finished" sounds.
- Mouse-first, with a prefix key for keyboard users.

### Steal / skip
- **Steal:**
  - The status model with done = idle && !seen and the attention rollup.
  - Snapshot + invalidation events with an `events_lost` resync.
  - An append-only contract with `Unknown` fallbacks.
  - Layered restore.
  - A semantic palette.
  - Notification policy.
- **Skip:**
  - Prefix keys, cell-grid surfaces and ANSI blitting.
  - Screen scraping. Hermes gives structured events through tui_gateway, so we don't need to scrape the screen.

## Hermes's own domain model (what our app will display)

Sources: `~/.hermes/hermes-agent/website/docs/user-guide/{profiles,bot-mode,sessions,desktop,multi-connection-desktop}.md`.

- **Gateway (one per machine).** One `hermes gateway` process serves every profile on a host, unless a profile sets `gateway.standalone: true`.
  - Clients reach it over HTTP(S), e.g. `http://host:9119`, and chat over WebSocket at `/api/ws` using one-use tickets.
  - Auth options: session token, username/password (`HERMES_DASHBOARD_BASIC_AUTH_*`), or OAuth (Nous Portal or OIDC).
  - Docs advice: keep it behind Tailscale or a VPN unless you use OAuth.
- **Profile = one agent.** A profile is an isolated home (`~/.hermes/profiles/<name>/`) with its own config/model, keys, `SOUL.md` personality, memory, skills, cron jobs and session database. The RPC has `profiles.list`, `profiles.create`, `profiles.configure`, `profiles.get_asset`, `profiles.set_asset`, …
- **"Bot" is a presentation of a profile, not a separate thing.**
  - The official desktop's Bot Mode shows a profile as a named Bot with an avatar and **one permanent "Bot Chat"**; there, `/new` compacts the chat instead of forking it.
  - Every Bot is a profile, but not every profile is a Bot.
  - A *messaging bot* is different: a Telegram/Discord/Slack account connected to a profile through the gateway.
- **Sessions: many per profile.** Each has a title, a source tag (`cli`, `telegram`, `cron`, `acp`, …), full history, token counts, and a parent link for compression splits. FTS5 search is supported. RPC: `session.list`, `session.create`, `session.resume`, `session.history`.
- **Subagents** are child conversations created by `delegate_task`, not profiles.
- **Attachments in the RPC:**
  - `image.attach` (server-side path), `image.attach_bytes` (base64), `file.attach` (path or `data_url`), `pdf.attach`, `image.generate`.
  - **For a remote gateway the client must always send bytes, never local paths.**
  - The contract has no dedicated video method. Whether video works through `file.attach` is still open.

## Other mental models

### T3 Code: organized by *where* the work happens
Sources: `AGENTS.md` glossary, `docs/user/thread-sidebar.md`, `apps/web/src/sidebarProjectGrouping.ts`.
- **Environment** = one running T3 server, plus its machine, filesystem, credentials and state.
- **Project** = a folder record that lives in one environment. The *client sidebar* groups each machine's copy of a project into one logical project and tags it local-only, remote-only or mixed.
- **Thread** = a conversation in one project on one environment. It runs in the main checkout or in its own Git worktree.
- **No-project thread** = gets its own scratch folder (`~/.t3/scratch/<date>-<words>-<id>`). **Turn into project** later promotes that folder in place.
- Lesson: the server model stays concrete and the client builds the friendly grouping on top.

### OpenBot (openbot.run, `nightly-labs/openbot`): organized by *who* does the work, running locally
- "Local-first desktop workspace for persistent AI teammates."
- **Agent** = name + instructions + its own workspace folder (`~/OpenBot/Agents/<id>`) + one provider (the "brain").
  - The agent keeps **one stable conversation** even when you switch provider (Codex → Claude → Grok). Provider session ids stay private.
- **Channels** = shared multi-agent rooms with one task owner, explicit delegation, and Stop/Resume/Reassign controls.
- **Queue** = per-agent FIFO with pause, resume and cancel.
- **Transfers** = files moved through `~/OpenBot/Shared/Transfers`, with manifests.
- **Stack:**
  - Electron + **SolidJS** + TypeScript, Bun/Node 24.
  - SQLite event log + projections; `packages/contracts` for typed boundaries.
  - Mobile connects over WebRTC (signal + TURN); the account API runs on Cloudflare Workers.
- **Providers:** Codex app-server, Claude Agent SDK, and ACP agents, **including `hermes acp`**.

### Grok Bot (xAI, beta Aug 2026, ships with Cursor): organized by *who*, running in the cloud
Sources are third-party (i-scoop, christopheralarcon.com); verify before relying on them.
- **Bot** = name + job. The sidebar lists bots, grouped into folders. Clicking one opens its chat.
- Each bot keeps its own memory, files, browser logins and preferences.
- **Creating a bot** takes one sentence. The bot then asks clarifying questions, drafts a plan and starts. Jobs follow the shape outcome / sources / constraints / deliverable / review point.
- **Routines** (schedules or event triggers) sit beside the bot. Results **arrive as messages**, unprompted.
- **Teach a Task:** a screen recording becomes a repeatable skill.
- **Runtime:** a persistent cloud computer (browser, filesystem, terminal), with one screen per bot. It keeps working while your laptop is closed, and you can take over a live session from your phone.
- Bots message each other and support group chats.
