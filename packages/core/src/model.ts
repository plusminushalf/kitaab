// The app's own vocabulary (docs/product/concept.md). The UI renders only these
// types. The Hermes adapter translates gateway data into them, so Hermes terms
// never leak into components.

export type Id = string

export type Project = {
  id: Id
  name: string
  /** Library personalities added to this project (its cast). */
  personalityIds?: Id[]
}

/** A named character from your library. Behaviour only: it never keeps project facts. */
export type Personality = {
  id: Id
  name: string
  /** One line for people: what this personality is for. */
  description?: string
  /** Who it is and how it works: identity, tone, craft. */
  instructions: string
  /** Names of the skills it reaches for. The list goes with it to every project it joins. */
  skills?: string[]
  updatedAt?: number
}

/** A written procedure the agent opens when a task needs it. Installed per project. */
export type Skill = {
  name: string
  description: string
  category?: string
  /** Off: the project keeps it but nobody can open it. */
  enabled: boolean
  /**
   * made: written in this project, by you or a personality (editable here).
   * installed: added from a skills hub. shared: from a folder outside the project.
   * builtin: ships with Hermes.
   */
  source: "made" | "installed" | "shared" | "builtin"
  /** How often it has been used. */
  usage?: number
}

export type Thread = {
  id: Id
  projectId: Id
  title: string
  updatedAt: number
  /** Personality ids; the first one is the host. */
  cast: Id[]
  /** Set when the thread grew out of a routine run. */
  fromRun?: { routineId: Id; runId: Id }
  status: "idle" | "working" | "needs-you"
  preview?: string
}

export type Attachment = {
  kind: "image" | "video" | "file"
  name: string
  /** Something the renderer can load directly: data:, blob: or http(s):. */
  url?: string
  /** Where the file lives on the server, when it does. */
  path?: string
  size?: number
}

export type ToolCall = {
  id: Id
  name: string
  summary?: string
  status: "running" | "done" | "error"
}

/** A stretch of an assistant turn: text it wrote, or thinking and tool calls in a row. */
export type Part = { type: "text"; text: string } | { type: "work"; reasoning?: string; tools: ToolCall[] }

export type Message = {
  id: Id
  role: "user" | "assistant" | "system"
  /** All of the turn's text, joined. `parts` has it in order with the work between. */
  text: string
  reasoning?: string
  tools?: ToolCall[]
  /** An assistant turn in the order it happened (see turn.ts). */
  parts?: Part[]
  attachments?: Attachment[]
  personalityId?: Id
  createdAt: number
  streaming?: boolean
  /** For an assistant turn: when the work started (the user's message) and ended. */
  startedAt?: number
  endedAt?: number
}

/** A helper agent a thread handed part of its work to (Hermes delegate_task). */
export type Subagent = {
  id: Id
  /** What it was asked to do. */
  goal: string
  status: "queued" | "running" | "completed" | "failed" | "interrupted"
  model?: string
  startedAt: number
  endedAt?: number
  toolCount?: number
  /** Its latest step while running, e.g. "terminal: npm test". */
  activity?: string
  /** What it reported back, or why it failed. */
  summary?: string
}

export type PendingQuestion = {
  id: Id
  /** "secret": a masked field whose answer goes straight to Hermes and is never kept in the app. */
  kind: "approval" | "clarify" | "secret" | "other"
  title: string
  detail?: string
  choices?: string[]
  /** A secret: where the value goes once entered, e.g. "Goes into ~/app/.env as OPENAI_API_KEY". */
  destination?: string
  /** A sudo password: the command it's for. */
  command?: string
}

export type Routine = {
  id: Id
  projectId: Id
  name: string
  schedule: string
  personalityId?: Id
  enabled: boolean
  lastRunAt?: number
  nextRunAt?: number
  /** How the last run ended. */
  lastStatus?: "ok" | "failed"
  lastError?: string
  /** Failed runs in a row, counting back from the last one. */
  failureStreak?: number
  /** True while a run is in progress. */
  running?: boolean
  /** Runs completed so far. */
  runCount?: number
  /** Skills and script the routine runs with. */
  skills?: string[]
  script?: string
  model?: string
  createdAt?: number
}

export type Run = {
  id: Id
  routineId: Id
  startedAt: number
  status: "ok" | "failed" | "running"
  /** The run's report, as markdown. */
  report?: string
  /** The thread this run turned into, once someone replied to it. */
  threadId?: Id
}
