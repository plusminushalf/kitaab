import { GENERAL } from "./model"
import type { Attachment, Id, Message, PendingQuestion, Personality, Profile, Project, Routine, Run, Skill, Subagent, Thread } from "./model"

export type Connection =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected"; server: string; version?: string }
  | { state: "error"; message: string; needsSignIn?: boolean }

export type ThreadDetail = {
  messages: Message[]
  pending: PendingQuestion[]
  loading: boolean
  /** Left over from a dropped connection, or shown from this device's cache: still shown, but loaded again. */
  stale?: boolean
  /** Hermes has no session for it (deleted, or a routine run that was cleaned up): it was taken off the lists. */
  missing?: boolean
}

export type ModelChoice = { model: string; provider: string; effort?: string; fast?: boolean }
export type ModelCaps = { fast: boolean; reasoning: boolean }
export type ModelProvider = { slug: string; name: string; models: string[]; caps: Record<string, ModelCaps> }

export type View =
  | { kind: "thread"; threadId: Id | null }
  | { kind: "routines" }
  | { kind: "runs" }
  | { kind: "routine"; routineId: Id }
  | { kind: "run"; routineId: Id; runId: Id }
  | { kind: "personalities" }
  | { kind: "profile" }
  | { kind: "done" }

export type SettingsSection = "general" | "threads" | "appearance"

/**
 * What sending does while a reply is running. "queue" waits for the reply to finish;
 * "interrupt" stops it and sends right away.
 */
export type SendMode = "queue" | "interrupt"

/** A message waiting for the running reply to finish. */
export type QueuedMessage = { id: string; text: string; attachments: Attachment[] }

/** A thread's waiting messages, sent one at a time in order. Stopping the reply pauses them. */
export type Queue = { items: QueuedMessage[]; paused: boolean }

export type State = {
  connection: Connection
  profiles: Profile[]
  profileId: Id | null
  /** Each profile's projects (General not included), once loaded, in Hermes's order. */
  projects: Record<Id, Project[]>
  /** The project new threads start in, in the open profile. GENERAL when none is picked. */
  projectId: Id
  personalities: Personality[]
  /** Each profile's installed skills, once loaded. */
  skills: Record<Id, Skill[]>
  threads: Thread[]
  /** Threads marked done (Hermes "archived"), newest first. */
  done: Thread[]
  doneCount: number
  /** Models the server can use, grouped by provider. */
  models: ModelProvider[]
  /** The model new threads start on: yours (myModel) when this project has it, else the project's. */
  defaultModel: ModelChoice | null
  /** Reasoning effort new threads start with, the same way. */
  defaultEffort: string
  /** The model set in the project's own Hermes config. */
  profileModel: ModelChoice | null
  profileEffort: string
  /** Your default for new threads in every project, from Settings (shared by all your devices). */
  myModel: ModelChoice | null
  /** Model picked for the next new thread. */
  draftModel: ModelChoice | null
  /** Model each open thread is running on. */
  threadModels: Record<Id, ModelChoice>
  routines: Routine[]
  runs: Record<Id, Run[]>
  details: Record<Id, ThreadDetail>
  /** Helper agents each thread started, oldest first. */
  subagents: Record<Id, Subagent[]>
  view: View
  /** The settings overlay's open section, or null when it's closed. */
  settings: SettingsSection | null
  /** Messages each thread is holding until its running reply finishes. */
  queued: Record<Id, Queue>
  /** What Enter does while a reply is running (⌘Enter does the other). This device only. */
  enterSends: SendMode
}

/** What the UI needs from a backend. The Hermes adapter implements it. */
export interface Backend {
  connect(): Promise<void>
  selectProfile(id: Id): Promise<void>
  /** Creates a Hermes profile set up like Default and switches to it. Resolves to its id. */
  createProfile(name: string): Promise<Id>
  /** Saves the order profiles are listed in (and ⌘1–⌘9 follow), for every device. */
  setProfileOrder(ids: Id[]): Promise<void>
  /** The project new threads start in (in the open profile). */
  selectProject(id: Id): void
  /**
   * Makes a project in the open profile and picks it. `folder` is a folder on the server to
   * work in; without one, Kitaab makes ~/kitaab/<profile>/<project>. Resolves to its id.
   */
  createProject(name: string, folder?: string): Promise<Id>
  renameProject(id: Id, name: string): Promise<void>
  /** Takes a project off the list (Hermes archives it). Its threads show in General; nothing is deleted. */
  removeProject(id: Id): Promise<void>
  loadThread(threadId: Id): Promise<void>
  /**
   * Starts a new thread when threadId is null. Resolves to the thread id. While a reply is
   * running, `how` decides: "queue" (the default) holds the message until it finishes,
   * "interrupt" stops it and sends now.
   */
  send(threadId: Id | null, text: string, attachments: Attachment[], how?: SendMode): Promise<Id>
  /**
   * Like send, but doesn't wait for the server: the message (and a new thread, under a local id
   * until Hermes names it) shows right away. Returns the thread id to show now. If it doesn't
   * go, the message stays in the thread marked failed, to retry or take back.
   */
  post(threadId: Id | null, text: string, attachments: Attachment[], how?: SendMode): Id
  /** Sends a message that failed again, where it sits. */
  retry(threadId: Id, messageId: Id): void
  /**
   * Takes a failed message back out of the thread (a thread that never got made goes with it),
   * handing back what it said so it can be edited.
   */
  unsend(threadId: Id, messageId: Id): { text: string; attachments: Attachment[] } | null
  /** Stops the running reply. Messages queued behind it wait until you send or remove them. */
  interrupt(threadId: Id): Promise<void>
  /** Sends a queued message now, stopping the running reply if there is one. */
  sendQueuedNow(threadId: Id, queuedId: string): Promise<void>
  /** Drops a queued message. */
  unqueue(threadId: Id, queuedId: string): void
  /** What Enter does while a reply is running, saved on this device. */
  setEnterSends(mode: SendMode): void
  answer(threadId: Id, question: PendingQuestion, value: string): Promise<void>
  /** Files a routine under one of its profile's projects (GENERAL for none). */
  setRoutineProject(routineId: Id, projectId: Id): Promise<void>
  loadRuns(routineId: Id): Promise<void>
  loadRunReport(routineId: Id, runId: Id): Promise<void>
  /** Replying to a run turns it into a thread. Resolves to the new thread id. */
  replyToRun(routineId: Id, runId: Id, text: string): Promise<Id>
  /** Done hides the thread from the list (Hermes archive); not done brings it back. */
  setDone(threadId: Id, done: boolean): Promise<void>
  /** Model for a thread, or for the next new thread when threadId is null. */
  setModel(threadId: Id | null, choice: ModelChoice): Promise<void>
  /** Your default model for new threads; null goes back to each project's own. */
  setMyModel(choice: ModelChoice | null): Promise<void>
  /** Re-reads which helper agents the thread has running. */
  loadSubagents(threadId: Id): Promise<void>
  stopSubagent(threadId: Id, subagentId: Id): Promise<void>
}

const initial: State = {
  connection: { state: "idle" },
  profiles: [],
  profileId: null,
  projects: {},
  projectId: GENERAL,
  personalities: [],
  skills: {},
  threads: [],
  done: [],
  doneCount: 0,
  models: [],
  defaultModel: null,
  defaultEffort: "medium",
  profileModel: null,
  profileEffort: "medium",
  myModel: null,
  draftModel: null,
  threadModels: {},
  routines: [],
  runs: {},
  details: {},
  subagents: {},
  view: { kind: "thread", threadId: null },
  settings: null,
  queued: {},
  enterSends: "queue",
}

let state = initial
const listeners = new Set<() => void>()

export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  updateDetail(threadId: Id, fn: (d: ThreadDetail) => ThreadDetail) {
    store.set((s) => ({
      details: { ...s.details, [threadId]: fn(s.details[threadId] ?? { messages: [], pending: [], loading: false }) },
    }))
  },
  /** Navigate like a browser: the current view goes on the back stack. */
  go(view: View) {
    if (JSON.stringify(view) === JSON.stringify(state.view)) return
    backStack.push(state.view)
    if (backStack.length > 100) backStack.shift()
    forwardStack.length = 0
    store.set({ view })
  },
  back(): boolean {
    const view = backStack.pop()
    if (!view) return false
    forwardStack.push(state.view)
    store.set({ view })
    return true
  },
  forward(): boolean {
    const view = forwardStack.pop()
    if (!view) return false
    backStack.push(state.view)
    store.set({ view })
    return true
  },
  /** A thread made here got its real id: the back and forward stacks follow it there. */
  retargetHistory(from: Id, to: Id) {
    const fix = (v: View): View => (v.kind === "thread" && v.threadId === from ? { ...v, threadId: to } : v)
    for (const stack of [backStack, forwardStack]) stack.forEach((v, i) => (stack[i] = fix(v)))
  },
  canGoBack: () => backStack.length > 0,
  canGoForward: () => forwardStack.length > 0,
}

const backStack: View[] = []
const forwardStack: View[] = []
