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
  updatedAt?: number
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

export type Message = {
  id: Id
  role: "user" | "assistant" | "system"
  text: string
  reasoning?: string
  tools?: ToolCall[]
  attachments?: Attachment[]
  personalityId?: Id
  createdAt: number
  streaming?: boolean
  /** For an assistant turn: when the work started (the user's message) and ended. */
  startedAt?: number
  endedAt?: number
}

export type PendingQuestion = {
  id: Id
  kind: "approval" | "clarify" | "other"
  title: string
  detail?: string
  choices?: string[]
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
