import { useSyncExternalStore } from "react"
import type { Attachment, Id, Message, PendingQuestion, Personality, Project, Routine, Run, Thread } from "./model"

export type Connection =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected"; server: string; version?: string }
  | { state: "error"; message: string; needsSignIn?: boolean }

export type ThreadDetail = {
  messages: Message[]
  pending: PendingQuestion[]
  loading: boolean
}

export type ModelChoice = { model: string; provider: string; effort?: string; fast?: boolean }
export type ModelCaps = { fast: boolean; reasoning: boolean }
export type ModelProvider = { slug: string; name: string; models: string[]; caps: Record<string, ModelCaps> }

export type View =
  | { kind: "thread"; threadId: Id | null }
  | { kind: "routines" }
  | { kind: "routine"; routineId: Id }
  | { kind: "run"; routineId: Id; runId: Id }
  | { kind: "personalities" }
  | { kind: "done" }

export type SettingsSection = "general" | "appearance"

export type State = {
  connection: Connection
  projects: Project[]
  projectId: Id | null
  personalities: Personality[]
  threads: Thread[]
  /** Threads marked done (Hermes "archived"), newest first. */
  done: Thread[]
  doneCount: number
  /** Models the server can use, grouped by provider. */
  models: ModelProvider[]
  /** The project's default model, used for new threads unless changed. */
  defaultModel: ModelChoice | null
  /** The profile's reasoning effort when a thread doesn't set one. */
  defaultEffort: string
  /** Model picked for the next new thread. */
  draftModel: ModelChoice | null
  /** Model each open thread is running on. */
  threadModels: Record<Id, ModelChoice>
  routines: Routine[]
  runs: Record<Id, Run[]>
  details: Record<Id, ThreadDetail>
  view: View
  /** The settings overlay's open section, or null when it's closed. */
  settings: SettingsSection | null
}

/** What the UI needs from a backend. The Hermes adapter implements it. */
export interface Backend {
  connect(): Promise<void>
  selectProject(id: Id): Promise<void>
  loadThread(threadId: Id): Promise<void>
  /** Starts a new thread when threadId is null. Resolves to the thread id. */
  send(threadId: Id | null, text: string, attachments: Attachment[]): Promise<Id>
  interrupt(threadId: Id): Promise<void>
  answer(threadId: Id, question: PendingQuestion, value: string): Promise<void>
  loadRuns(routineId: Id): Promise<void>
  loadRunReport(routineId: Id, runId: Id): Promise<void>
  /** Replying to a run turns it into a thread. Resolves to the new thread id. */
  replyToRun(routineId: Id, runId: Id, text: string): Promise<Id>
  /** Done hides the thread from the list (Hermes archive); not done brings it back. */
  setDone(threadId: Id, done: boolean): Promise<void>
  /** Model for a thread, or for the next new thread when threadId is null. */
  setModel(threadId: Id | null, choice: ModelChoice): Promise<void>
}

const initial: State = {
  connection: { state: "idle" },
  projects: [],
  projectId: null,
  personalities: [],
  threads: [],
  done: [],
  doneCount: 0,
  models: [],
  defaultModel: null,
  defaultEffort: "medium",
  draftModel: null,
  threadModels: {},
  routines: [],
  runs: {},
  details: {},
  view: { kind: "thread", threadId: null },
  settings: null,
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
  canGoBack: () => backStack.length > 0,
  canGoForward: () => forwardStack.length > 0,
}

const backStack: View[] = []
const forwardStack: View[] = []

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state))
}
