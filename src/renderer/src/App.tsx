import { useEffect } from "react"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { PersonalitiesView } from "@/components/personalities-view"
import { ProjectView } from "@/components/project-view"
import { DoneView } from "@/components/done-view"
import { AllRunsView, RoutinesView, RoutineView, RunView } from "@/components/routine-views"
import { SettingsOverlay } from "@/components/settings/settings-page"
import { ThemeEditor } from "@/components/settings/theme-editor"
import { appearance, useAppearance } from "@/lib/appearance/store"
import { ThreadView } from "@/components/thread-view"
import { ConnectionView } from "@/components/connection-view"
import { SwipeIndicator } from "@/components/swipe-indicator"
import { backend, clearUndoableDone, hasUndoableDone, undoLastDone, viewIdentity } from "@kitab/core/backend"
import { store, useStore } from "@/lib/store"
import { draftKey } from "@/lib/composer-drafts"
import { checkForUpdatesLoudly, useUpdateState } from "@/lib/updates"

export function App() {
  return (
    <TooltipProvider>
      <SidebarProvider className="h-full min-h-0">
        <Shell />
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

function Shell() {
  const view = useStore((s) => s.view)
  const projectId = useStore((s) => s.projectId)
  const connection = useStore((s) => s.connection)
  const blocked = connection.state === "error" && connection.needsSignIn
  const openSettings = () => store.set({ settings: "general" })
  const editing = useAppearance((s) => s.editing)
  const { toggleSidebar } = useSidebar()
  // Subscribes to the updater from the root, so its toasts show whatever is on screen.
  useUpdateState()

  useEffect(() => {
    void backend.connect()
  }, [])

  // ⌘Z undoes "mark as done". Inside a text field it only does so while the field is
  // empty (the composer takes focus after a thread is marked done), and typing
  // anything hands ⌘Z back to the text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== "z") return
      if (!hasUndoableDone() || hasText(e.target)) return
      e.preventDefault()
      undoLastDone()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("input", clearUndoableDone, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("input", clearUndoableDone, true)
    }
  }, [])

  // ⌘1–⌘9 switch to the nth project, in the project picker's order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      if (!n) return
      e.preventDefault()
      const { projects, projectId } = store.get()
      const target = projects[Number(n) - 1]
      if (target && target.id !== projectId) void backend.selectProject(target.id)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(
    () =>
      window.hermes.onMenu((command) => {
        switch (command) {
          case "settings":
            return openSettings()
          case "check-updates":
            return void checkForUpdatesLoudly()
          case "new-thread":
            return store.go({ kind: "thread", threadId: null })
          case "toggle-sidebar":
            return toggleSidebar()
          case "go-threads":
            return store.go({ kind: "thread", threadId: store.get().threads[0]?.id ?? null })
          case "go-routines":
            return store.go({ kind: "routines" })
          case "go-personalities":
            return store.go({ kind: "personalities" })
          case "go-project":
            return store.go({ kind: "project" })
          case "mark-done": {
            const v = store.get().view
            if (v.kind !== "thread" || !v.threadId) return
            // Listed as a thread wins: only a thread that's gone from the list gets restored.
            const s = store.get()
            const isDone = !s.threads.some((t) => t.id === v.threadId) && s.done.some((t) => t.id === v.threadId)
            return void backend.setDone(v.threadId, !isDone)
          }
          case "back":
            return void store.back()
          case "forward":
            return void store.forward()
        }
      }),
    [toggleSidebar],
  )

  return (
    <>
      <AppSidebar onOpenSettings={() => openSettings()} />
      {/* The content pane is opaque; only the sidebar shows the window's vibrancy. */}
      <SidebarInset className="min-h-0 overflow-hidden bg-background">
        {blocked && <ConnectionView onOpenSettings={() => openSettings()} />}
        {/* Keyed by the id the thread was first shown under, so a new thread getting its real id doesn't remount it. */}
        {!blocked && view.kind === "thread" && (
          <ThreadView key={draftKey(view.threadId && viewIdentity(view.threadId), projectId)} threadId={view.threadId} />
        )}
        {!blocked && view.kind === "routines" && <RoutinesView />}
        {!blocked && view.kind === "runs" && <AllRunsView />}
        {!blocked && view.kind === "routine" && <RoutineView routineId={view.routineId} />}
        {!blocked && view.kind === "run" && <RunView routineId={view.routineId} runId={view.runId} />}
        {!blocked && view.kind === "personalities" && <PersonalitiesView />}
        {!blocked && view.kind === "project" && <ProjectView />}
        {!blocked && view.kind === "done" && <DoneView />}
      </SidebarInset>
      <SettingsOverlay />
      {editing && (
        <ThemeEditor
          target={editing}
          onClose={() => {
            appearance.closeEditor()
            store.set({ settings: "appearance" })
          }}
        />
      )}
      <SwipeIndicator />
    </>
  )
}

/** A focused text field with something in it, where ⌘Z should undo typing. */
function hasText(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value !== ""
  if (target instanceof HTMLElement && target.isContentEditable) return (target.textContent ?? "") !== ""
  return false
}
