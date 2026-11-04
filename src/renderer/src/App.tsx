import { useEffect } from "react"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { PersonalitiesView } from "@/components/personalities-view"
import { DoneView } from "@/components/done-view"
import { AllRunsView, RoutinesView, RoutineView, RunView } from "@/components/routine-views"
import { SettingsOverlay } from "@/components/settings/settings-page"
import { ThemeEditor } from "@/components/settings/theme-editor"
import { appearance, useAppearance } from "@/lib/appearance/store"
import { ThreadView } from "@/components/thread-view"
import { ConnectionView } from "@/components/connection-view"
import { SwipeIndicator } from "@/components/swipe-indicator"
import { backend } from "@/lib/backend"
import { store, useStore } from "@/lib/store"

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
  const connection = useStore((s) => s.connection)
  const blocked = connection.state === "error" && connection.needsSignIn
  const openSettings = () => store.set({ settings: "general" })
  const editing = useAppearance((s) => s.editing)
  const { toggleSidebar } = useSidebar()

  useEffect(() => {
    void backend.connect()
  }, [])

  useEffect(
    () =>
      window.hermes.onMenu((command) => {
        switch (command) {
          case "settings":
            return openSettings()
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
          case "mark-done": {
            const v = store.get().view
            if (v.kind !== "thread" || !v.threadId) return
            const isDone = store.get().done.some((t) => t.id === v.threadId)
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
        {!blocked && view.kind === "thread" && <ThreadView key={view.threadId ?? "new"} threadId={view.threadId} />}
        {!blocked && view.kind === "routines" && <RoutinesView />}
        {!blocked && view.kind === "runs" && <AllRunsView />}
        {!blocked && view.kind === "routine" && <RoutineView routineId={view.routineId} />}
        {!blocked && view.kind === "run" && <RunView routineId={view.routineId} runId={view.runId} />}
        {!blocked && view.kind === "personalities" && <PersonalitiesView />}
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
