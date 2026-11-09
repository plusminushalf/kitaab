import type { Id } from "./model"
import { gw } from "./backend"
import { installPlugin, PLUGIN_FILES } from "./kitaab-plugin"
import { http, platform, type Platform } from "./platform"

// What Hermes is told about Kitaab, so the agent knows which app it's talking through.
//
// Kitaab starts its backend with HERMES_DESKTOP=1, so Hermes treats every Kitaab chat as the
// official Hermes desktop app and gives the agent that app's paragraph (MEDIA: cards,
// ::preview widgets…), none of which Kitaab shows. In every project (profile) Kitaab writes:
//   config.yaml  platform_hints.desktop.replace   Kitaab's own paragraph for chats
//   config.yaml  platform_hints.cron.append       a note for routine runs
// (platform_hints is a top-level key; Hermes ignores it under agent:)
//   skill        kitab                                  how to do things in Kitaab, read on demand
//   plugin       plugins/kitaab                         start_thread and request_secret (kitaab-plugin.ts)
//   ui_meta      kitab.context                          what was written, so it's written once
//
// Which apps the user has is kept on the default profile, one key per install:
//   ui_meta["kitab.device.<id>"] = { kind: "mac" | "iphone", seenAt: "YYYY-MM-DD" }

export type DeviceKind = Platform["kind"]

/** Bump when the texts change in a way older apps shouldn't undo. */
const VERSION = 6
const DEVICE = "kitab.device."
const MARKER = "kitab.context"
const SKILL = "kitab"
/** An app not seen for this long is treated as gone. */
const STALE_DAYS = 60

type ProfileRow = { name: string; path?: string; display_name?: string; is_default?: boolean; ui_meta?: Record<string, any> }

const today = () => new Date().toISOString().slice(0, 10)
const q = encodeURIComponent

function deviceId(): string {
  const p = platform()
  let id = p.storage.get("kitab.deviceId")
  if (!id) {
    id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
    p.storage.set("kitab.deviceId", id)
  }
  return id
}

function homeOf(rows: ProfileRow[]) {
  return rows.find((r) => r.is_default) ?? rows.find((r) => r.name === "default") ?? rows[0]
}

/** Records this app on the server (at most once a day). Returns the apps the user has. */
async function registerDevice(rows: ProfileRow[]): Promise<DeviceKind[]> {
  const home = homeOf(rows)
  if (!home) return [platform().kind]
  const meta = { ...(home.ui_meta ?? {}) }
  const key = DEVICE + deviceId()
  const mine = { kind: platform().kind, seenAt: today() }
  const had = meta[key]
  if (had?.kind !== mine.kind || had?.seenAt !== mine.seenAt) {
    try {
      await gw.call("profiles.configure", { name: home.name, ui_meta: { [key]: mine } })
    } catch (e) {
      console.warn("[kitab-context] couldn't record this device", e)
    }
    meta[key] = mine
  }
  const cutoff = Date.now() - STALE_DAYS * 86_400_000
  const kinds = new Set<DeviceKind>()
  for (const [k, v] of Object.entries(meta)) {
    if (!k.startsWith(DEVICE) || (v?.kind !== "mac" && v?.kind !== "iphone")) continue
    if (Date.parse(v.seenAt) >= cutoff) kinds.add(v.kind)
  }
  return (["mac", "iphone"] as const).filter((k) => kinds.has(k))
}

// ---- the texts ---------------------------------------------------------------------------

type Project = { id: Id; name: string }

function where(kinds: DeviceKind[]): string {
  const mac = kinds.includes("mac")
  const iphone = kinds.includes("iphone")
  if (mac && iphone) return "on their Mac and on their iPhone"
  return iphone ? "on their iPhone" : "on their Mac"
}

const RENDERING =
  "Kitaab renders GitHub-flavoured markdown: headings, lists, tables, code blocks and links. To show an " +
  "image you made or found on the server (a chart, a card, a screenshot), embed it with markdown image " +
  "syntax and its full path on the server, for example `![Weekly chart](/home/me/out/chart.png)`; " +
  "Kitaab loads it from the server and shows it in your reply. Web image URLs work too. Kitaab doesn't " +
  "render math, Mermaid, raw HTML, MEDIA: tags or ::preview widgets, so don't use them; to point to " +
  "any other file, give its full path on the server."

const SECRETS =
  "When you need a secret from the user (an API key, token or password), call the `request_secret` tool. " +
  "Kitaab shows the user a masked field, and the value goes straight into the .env file, private file or " +
  "Hermes setting you name, without you or this chat ever seeing it. Never ask the user to paste a secret " +
  "into the chat, and never print one you've saved."

function phoneNote(kinds: DeviceKind[]): string {
  return kinds.includes("iphone")
    ? " The iPhone screen is narrow: keep tables to a few columns and paragraphs short."
    : ""
}

/** Replaces Hermes's "desktop" paragraph in this project's chats. */
export function chatHint(project: Project, kinds: DeviceKind[]): string {
  return [
    `You're chatting through Kitaab, the user's own app for Hermes (not the official Hermes desktop app). ` +
      `The user has Kitaab ${where(kinds)}. Every Kitaab app shows the same projects, threads and routines, ` +
      `kept in sync through this server, so the user may read your reply on any of them.${phoneNote(kinds)}`,
    RENDERING,
    `In Kitaab, a Hermes profile is a project, a session is a thread, a cron job is a routine, and each run ` +
      `of a cron job is a run. This chat is a thread in the project "${project.name}" (profile ` +
      `\`${project.id}\`). Use Kitaab's words with the user. Before you do anything in Kitaab itself ` +
      `(start or hand off to a new thread, link to a thread, routine or run, set up a routine), load the ` +
      `\`${SKILL}\` skill.`,
    SECRETS,
  ].join("\n\n")
}

/** Added to Hermes's own paragraph for cron runs in this project. */
export function routineHint(project: Project, kinds: DeviceKind[]): string {
  return [
    `This cron job is a routine in Kitaab, the user's own app for Hermes, in the project "${project.name}". ` +
      `The user reads each run's final response as its report in Kitaab ${where(kinds)}, under the ` +
      `routine's runs, and can reply to it there.${phoneNote(kinds)}`,
    RENDERING,
  ].join("\n\n")
}

/** The `kitab` skill: how to do things in Kitaab (threads, links, routines, secrets) and what to leave alone. */
export function skillText(project: Project, kinds: DeviceKind[]): string {
  const p = project.id
  const description =
    "How to do things in Kitaab: start or hand off to a new thread, link to threads, routines and runs, set up routines, ask for secrets"
  return `---
name: ${SKILL}
description: ${JSON.stringify(description)}
---

# Kitaab

Kitaab is the user's own app for Hermes. They have it ${where(kinds)}. Every Kitaab app reads this
server, so all of them show the same projects, threads, routines and runs. You're in the project
"${project.name}", which is the Hermes profile \`${p}\`.

This skill is how you do things in Kitaab itself. Kitaab only shows what is on this server, so do
these through the tools named here, never by editing Hermes's files or databases yourself.

## Kitaab's words

Use Kitaab's words with the user.

| Hermes | Kitaab |
|---|---|
| profile | project |
| session (not from cron) | thread |
| cron job | routine |
| the session a cron job ran in | run (its last reply is the run's report) |
| archived session | done thread |

## Start a new thread

Use the \`start_thread\` tool when work should carry on in a thread of its own: the user asks you to
hand something off, to start a new thread for it, or to split a side task out of this one. It makes a
real Kitaab thread, sends your message as its first message, and that thread's agent answers it
right away. The user sees it in the thread list, on every device.

1. Pick a short \`title\` (a few words) and, only if it belongs elsewhere, a \`project\` (a profile id;
   leave it out for this project).
2. Write the \`message\` as a brief for someone who has never seen this chat, because the new thread
   can't see it:
   - the goal, and why;
   - what is already known or decided, so it doesn't ask again;
   - full paths of the files, and the links, it should read;
   - the user's preferences that matter for this work;
   - what its first reply should do. If the user has to tell it something first (a story, a choice),
     say "Start by asking the user for …; don't draft anything until they answer."
3. Tell the user it's started, with the link from the result:
   \`[Launch post story](kitaab://thread/<id>?project=${p})\`.

Never start a thread with \`hermes chat\`, a script or by editing \`state.db\`: those sessions don't
show in Kitaab, or show broken. \`start_thread\` and \`request_secret\` come from Kitaab's plugin and
may not be loaded yet: look them up with \`tool_describe\`. If they don't exist, tell the user to open
Kitaab so it can set this project up, rather than working around it.

Helpers (\`delegate_task\`) are different: they work for this thread and report back to it. Use them
for work this thread waits on, and \`start_thread\` for work the user carries on in its own thread.

## Link to a thread, routine or run

Write these as ordinary markdown links. When the user taps one inside Kitaab, the app opens that
place, switching project first if needed. Always keep \`?project=\`.

| Opens | Link |
|---|---|
| a thread | \`kitaab://thread/<session id>?project=${p}\` |
| a routine | \`kitaab://routine/<cron job id>?project=${p}\` |
| one run's report | \`kitaab://run/<cron job id>/<run session id>?project=${p}\` |
| the project's routines | \`kitaab://routines?project=${p}\` |
| the project's done threads | \`kitaab://done?project=${p}\` |
| the project's settings | \`kitaab://project?project=${p}\` |
| the personality library | \`kitaab://personalities\` |

Example: \`[Open the routine](kitaab://routine/3f9a1c2b?project=${p})\`

Only link to ids you have looked up, never guessed ones:
- **Cron job ids:** the \`cronjob\` tool with \`action: "list"\`.
- **Session ids** (threads and runs): \`session_search\`, or the id \`start_thread\` returned. A run's
  session has the source \`cron\`.

Links only open inside Kitaab. Anywhere else (Telegram, email), describe where to look instead,
for example "Kitaab → ${project.name} → Routines → Morning brief".

## Set up a routine

A routine is a cron job; the \`cronjob\` tool creates, edits, pauses and removes them, and Kitaab's
Routines list follows. Each run starts with no memory of this chat, so write its prompt as a full
brief, like a \`start_thread\` message. The run's last reply is the report the user reads, so ask
for the report you want them to see. After creating one, link to it.

## Ask for a secret

Call \`request_secret\` for an API key, token or password. Kitaab shows the user a masked field and
the value goes straight to the .env file, private file or Hermes setting you name; you never see it.
Never ask for a secret in the chat, and never print one.

## Leave these alone

- **Personalities** (Designer, Coach…) are Kitaab's own; the user manages them in Kitaab.
- **Kitaab's data:** \`ui_meta\` keys starting with \`kitab.\` in each profile's \`profile.yaml\`, the
  \`kitaab\` plugin under \`plugins/\`, and this skill. Kitaab rewrites them, so edits are lost.
- **\`state.db\`**: never write to it. Use the tools above.
`
}

// ---- writing it to every project ---------------------------------------------------------

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

async function upsertSkill(profile: Id, content: string) {
  let existing: string | undefined
  try {
    existing = (await http().get<{ content: string }>(`/api/skills/content?name=${SKILL}&profile=${q(profile)}`)).content
  } catch {}
  if (existing === content) return
  if (existing === undefined) {
    await http().post(`/api/skills?profile=${q(profile)}`, { name: SKILL, content, category: null, profile })
  } else {
    await http().put(`/api/skills/content?profile=${q(profile)}`, { name: SKILL, content, profile })
  }
}

async function writeProject(project: Project, home: string | undefined, kinds: DeviceKind[], stamp: { version: number; hash: string }) {
  const chat = chatHint(project, kinds)
  const routine = routineHint(project, kinds)
  // Deep-merged into config.yaml by Hermes; other settings are left alone.
  await http().put(`/api/config?profile=${q(project.id)}`, {
    profile: project.id,
    config: { platform_hints: { desktop: { replace: chat }, cron: { append: routine } } },
  })
  await upsertSkill(project.id, skillText(project, kinds))
  if (home) await installPlugin(project.id, home)
  await gw.call("profiles.configure", { name: project.id, ui_meta: { [MARKER]: stamp } })
}

let syncing: Promise<void> | null = null

/** Records this app and brings every project's Kitaab context up to date. Cheap when nothing changed. */
export function syncKitabContext(rows: ProfileRow[]): Promise<void> {
  syncing ??= (async () => {
    const kinds = await registerDevice(rows)
    for (const row of rows) {
      const project = { id: row.name, name: row.display_name || (row.name === "default" ? "Default" : row.name) }
      const stamp = {
        version: VERSION,
        hash: hash(
          [chatHint(project, kinds), routineHint(project, kinds), skillText(project, kinds), ...Object.values(PLUGIN_FILES)].join("\0"),
        ),
      }
      const had = row.ui_meta?.[MARKER]
      // A newer Kitaab manages this project; don't undo its texts.
      if (typeof had?.version === "number" && had.version > VERSION) continue
      if (had?.version === stamp.version && had?.hash === stamp.hash) continue
      try {
        await writeProject(project, row.path, kinds, stamp)
      } catch (e) {
        console.warn(`[kitab-context] couldn't update ${project.id}`, e)
      }
    }
  })().finally(() => (syncing = null))
  return syncing
}
