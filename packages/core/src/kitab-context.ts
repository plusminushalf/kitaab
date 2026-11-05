import type { Id } from "./model"
import { gw } from "./backend"
import { http, platform, type Platform } from "./platform"

// What Hermes is told about Kitab, so the agent knows which app it's talking through.
//
// Kitab starts its backend with HERMES_DESKTOP=1, so Hermes treats every Kitab chat as the
// official Hermes desktop app and gives the agent that app's paragraph (MEDIA: cards,
// ::preview widgets…), none of which Kitab shows. In every project (profile) Kitab writes:
//   config.yaml  platform_hints.desktop.replace   Kitab's own paragraph for chats
//   config.yaml  platform_hints.cron.append       a note for routine runs
// (platform_hints is a top-level key; Hermes ignores it under agent:)
//   skill        kitab                                  words and kitab:// links, read on demand
//   ui_meta      kitab.context                          what was written, so it's written once
//
// Which apps the user has is kept on the default profile, one key per install:
//   ui_meta["kitab.device.<id>"] = { kind: "mac" | "iphone", seenAt: "YYYY-MM-DD" }

export type DeviceKind = Platform["kind"]

/** Bump when the texts change in a way older apps shouldn't undo. */
const VERSION = 2
const DEVICE = "kitab.device."
const MARKER = "kitab.context"
const SKILL = "kitab"
/** An app not seen for this long is treated as gone. */
const STALE_DAYS = 60

type ProfileRow = { name: string; display_name?: string; is_default?: boolean; ui_meta?: Record<string, any> }

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
  "Kitab renders GitHub-flavoured markdown: headings, lists, tables, code blocks and links. It doesn't " +
  "render math, Mermaid, raw HTML, MEDIA: tags or ::preview widgets, so don't use them; to point to a " +
  "file, give its full path on the server."

function phoneNote(kinds: DeviceKind[]): string {
  return kinds.includes("iphone")
    ? " The iPhone screen is narrow: keep tables to a few columns and paragraphs short."
    : ""
}

/** Replaces Hermes's "desktop" paragraph in this project's chats. */
export function chatHint(project: Project, kinds: DeviceKind[]): string {
  return [
    `You're chatting through Kitab, the user's own app for Hermes (not the official Hermes desktop app). ` +
      `The user has Kitab ${where(kinds)}. Every Kitab app shows the same projects, threads and routines, ` +
      `kept in sync through this server, so the user may read your reply on any of them.${phoneNote(kinds)}`,
    RENDERING,
    `In Kitab, a Hermes profile is a project, a session is a thread, a cron job is a routine, and each run ` +
      `of a cron job is a run. This chat is a thread in the project "${project.name}" (profile ` +
      `\`${project.id}\`). Use Kitab's words with the user. For links that open a thread, routine or run ` +
      `inside Kitab, and what you can change there, load the \`${SKILL}\` skill.`,
  ].join("\n\n")
}

/** Added to Hermes's own paragraph for cron runs in this project. */
export function routineHint(project: Project, kinds: DeviceKind[]): string {
  return [
    `This cron job is a routine in Kitab, the user's own app for Hermes, in the project "${project.name}". ` +
      `The user reads each run's final response as its report in Kitab ${where(kinds)}, under the ` +
      `routine's runs, and can reply to it there.${phoneNote(kinds)}`,
    RENDERING,
  ].join("\n\n")
}

/** The `kitab` skill: Kitab's words, links into the app, and what the agent may change. */
export function skillText(project: Project, kinds: DeviceKind[]): string {
  const p = project.id
  const description = "Links that open threads, routines and runs in Kitab"
  return `---
name: ${SKILL}
description: ${JSON.stringify(description)}
---

# Kitab

Kitab is the user's own app for Hermes. They have it ${where(kinds)}. Every Kitab app reads this
server, so all of them show the same projects, threads, routines and runs. You're in the project
"${project.name}", which is the Hermes profile \`${p}\`.

## Kitab's words

| Hermes | Kitab |
|---|---|
| profile | project |
| session (not from cron) | thread |
| cron job | routine |
| the session a cron job ran in | run (its last reply is the run's report) |
| archived session | done thread |

Personalities are Kitab's own: characters (Designer, Coach…) the user adds to a project and to
threads. Kitab manages them; don't edit them yourself.

## Links into Kitab

Write these as ordinary markdown links. When the user taps one inside Kitab, the app opens that
place, switching project first if needed. Always keep \`?project=\`.

| Opens | Link |
|---|---|
| a thread | \`kitab://thread/<session id>?project=${p}\` |
| a routine | \`kitab://routine/<cron job id>?project=${p}\` |
| one run's report | \`kitab://run/<cron job id>/<run session id>?project=${p}\` |
| the project's routines | \`kitab://routines?project=${p}\` |
| the project's done threads | \`kitab://done?project=${p}\` |
| the project's settings | \`kitab://project?project=${p}\` |
| the personality library | \`kitab://personalities\` |

Example: \`[Open the routine](kitab://routine/3f9a1c2b?project=${p})\`

Only link to ids you have looked up, never guessed ones:
- **Cron job ids:** the \`cronjob\` tool with \`action: "list"\`.
- **Session ids** (threads and runs): \`session_search\`. A run's session has the source \`cron\`.

Links only open inside Kitab. Anywhere else (Telegram, email), describe where to look instead,
for example "Kitab → ${project.name} → Routines → Morning brief".

## What you can change in Kitab

Kitab shows what is on this server, so these show up in the app:
- Creating, editing, pausing or removing a cron job (the \`cronjob\` tool) changes the project's routines.
- Creating or editing a skill changes the project's skills.

Kitab keeps its own data in each profile's \`profile.yaml\` under \`ui_meta\` keys starting with
\`kitab.\`. Never edit those, or this skill: Kitab rewrites the skill when it changes.
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

async function writeProject(project: Project, kinds: DeviceKind[], stamp: { version: number; hash: string }) {
  const chat = chatHint(project, kinds)
  const routine = routineHint(project, kinds)
  // Deep-merged into config.yaml by Hermes; other settings are left alone.
  await http().put(`/api/config?profile=${q(project.id)}`, {
    profile: project.id,
    config: { platform_hints: { desktop: { replace: chat }, cron: { append: routine } } },
  })
  await upsertSkill(project.id, skillText(project, kinds))
  await gw.call("profiles.configure", { name: project.id, ui_meta: { [MARKER]: stamp } })
}

let syncing: Promise<void> | null = null

/** Records this app and brings every project's Kitab context up to date. Cheap when nothing changed. */
export function syncKitabContext(rows: ProfileRow[]): Promise<void> {
  syncing ??= (async () => {
    const kinds = await registerDevice(rows)
    for (const row of rows) {
      const project = { id: row.name, name: row.display_name || (row.name === "default" ? "Default" : row.name) }
      const stamp = {
        version: VERSION,
        hash: hash([chatHint(project, kinds), routineHint(project, kinds), skillText(project, kinds)].join("\0")),
      }
      const had = row.ui_meta?.[MARKER]
      // A newer Kitab manages this project; don't undo its texts.
      if (typeof had?.version === "number" && had.version > VERSION) continue
      if (had?.version === stamp.version && had?.hash === stamp.hash) continue
      try {
        await writeProject(project, kinds, stamp)
      } catch (e) {
        console.warn(`[kitab-context] couldn't update ${project.id}`, e)
      }
    }
  })().finally(() => (syncing = null))
  return syncing
}
