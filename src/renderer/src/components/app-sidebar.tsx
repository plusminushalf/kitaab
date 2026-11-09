import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronRight, ChevronsUpDown, Clock, Copy, Ellipsis, Folder, FolderOpen, FolderPlus, ListFilter, PenLine, Repeat, RotateCw, Search, Settings, SquarePen, Trash2, Users, X } from "lucide-react"
import { toast } from "sonner"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { aggregateStatus, hue, ProjectBadge, StatusPill } from "@/components/project-badge"
import { ProfilePicker } from "@/components/profile-picker"
import { UpdateButton } from "@/components/update-button"
import { backend, reconnectNow, setShownThreadOrder } from "@kitab/core/backend"
import { store, useStore } from "@/lib/store"
import { useHasDraft } from "@/lib/composer-drafts"
import { adoptUnknown, markSeen, useUnseen } from "@/lib/seen-threads"
import { useThreadSwitching } from "@/lib/thread-switching"
import { appearance, useAppearance, type SidebarLayout } from "@/lib/appearance/store"
import { cn } from "@/lib/utils"
import { useShortcutLabel, withShortcut } from "@/lib/shortcuts"
import { homePath, relativeTime } from "@kitab/core/format"
import { modelName, shortModelName } from "@kitab/core/model-names"
import { providerIcon, providerTint } from "@/components/model-picker"
import { Spinner } from "@/components/ui/spinner"
import { shownStatus } from "@kitab/core/subagents"
import { GENERAL, type Id, type Project, type Thread } from "@kitab/core/model"
import { confirmRemoveProject, openNewProject, openRenameProject, startNewThread, useProfileProjects } from "@/components/project-menu"

type Sort = "activity" | "status" | "title"
const SORT_KEY = "kitab.sidebarSort"
const STATUS_RANK: Record<Thread["status"], number> = { "needs-you": 0, working: 1, idle: 2 }

function readSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === "status" || v === "title" ? v : "activity"
  } catch {
    return "activity"
  }
}

/** Threads matching the search, in the chosen order. */
function arrange(list: Thread[], query: string, sort: Sort): Thread[] {
  const q = query.trim().toLowerCase()
  const shown = q ? list.filter((t) => t.title.toLowerCase().includes(q)) : [...list]
  return shown.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "status"
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt - a.updatedAt
        : b.updatedAt - a.updatedAt,
  )
}

export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const newThreadKey = useShortcutLabel("new-thread")
  const settingsKey = useShortcutLabel("settings")
  const profiles = useStore((s) => s.profiles)
  const profileId = useStore((s) => s.profileId)
  const allThreads = useStore((s) => s.threads)
  const view = useStore((s) => s.view)
  const connection = useStore((s) => s.connection)
  const doneCount = useStore((s) => s.doneCount)
  const [sort, setSortState] = useState<Sort>(readSort)
  const [query, setQuery] = useState("")

  const setSort = (v: Sort) => {
    setSortState(v)
    try {
      localStorage.setItem(SORT_KEY, v)
    } catch {}
  }

  const profile = profiles.find((p) => p.id === profileId)
  const projects = useProfileProjects()
  const profileThreads = useMemo(() => allThreads.filter((t) => t.profileId === profileId), [allThreads, profileId])
  const layout = useAppearance((s) => s.settings.sidebarLayout)
  const [collapsed, toggleCollapsed] = useCollapsedProjects(profileId)
  const searching = query.trim() !== ""

  // Each project with its threads (searched and sorted), General first. Searching hides
  // projects with no match and opens the rest.
  const groups = useMemo(
    () =>
      projects
        .map((p) => ({ project: p, all: profileThreads.filter((t) => t.projectId === p.id) }))
        .map((g) => ({ ...g, threads: arrange(g.all, query, sort) }))
        .filter((g) => !searching || g.threads.length > 0),
    [projects, profileThreads, query, sort, searching],
  )
  // Only General: no project headers, the list looks as it always has.
  const flat = projects.length === 1
  // The list layout: one list of T3-style cards across every project, each saying where it lives.
  const cards = !flat && layout === "switcher"
  const cardList = useMemo(
    () => (cards ? arrange(profileThreads, query, sort) : []),
    [cards, profileThreads, query, sort],
  )
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const isOpen = (id: Id) => searching || flat || !collapsed.has(id)
  // The threads as shown, top to bottom, for ⌘[ ]/Ctrl+Tab and for moving on after "done".
  const shown = useMemo(
    () => (cards ? cardList : groups.flatMap((g) => (isOpen(g.project.id) ? g.threads : []))),
    [cards, cardList, groups, collapsed, searching, flat],
  )
  useEffect(() => setShownThreadOrder(shown.map((t) => t.id)), [shown])
  const activeThreadId = view.kind === "thread" ? view.threadId : null
  useEffect(() => adoptUnknown(profileThreads), [profileThreads])
  // The open thread counts as read whenever it moves while the window has focus, and
  // again when you come back to the window.
  const activeUpdatedAt = profileThreads.find((t) => t.id === activeThreadId)?.updatedAt
  useEffect(() => {
    if (!activeThreadId || activeUpdatedAt === undefined) return
    // Read as of now, not just as of its timestamp: Hermes's list can later report a
    // last-active a little after the live one for the same reply.
    const mark = () => markSeen(activeThreadId, Math.max(activeUpdatedAt, Date.now()))
    if (document.hasFocus()) mark()
    window.addEventListener("focus", mark)
    return () => {
      window.removeEventListener("focus", mark)
      if (document.hasFocus()) mark()
    }
  }, [activeThreadId, activeUpdatedAt])
  useThreadSwitching(shown, profileThreads)
  const inRoutines = view.kind === "routines" || view.kind === "routine" || view.kind === "run"

  return (
    <Sidebar>
      {/* Clear space for the traffic lights; the strip drags the window. */}
      <div className="app-drag h-[52px] shrink-0" />
      <SidebarHeader className="px-1 pt-0">
        <div className="flex items-center gap-0.5">
          <SearchField value={query} onChange={setQuery} />
          <DropdownMenu>
            <IconTip label="Sort and view">
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-sidebar-muted-foreground" />}>
                <ListFilter />
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="min-w-44" data-over-vibrancy>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort threads by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  <DropdownMenuRadioItem value="activity">Last activity</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show projects as</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={layout}
                  onValueChange={(v) => appearance.update({ sidebarLayout: v as SidebarLayout })}
                >
                  <DropdownMenuRadioItem value="switcher">A list</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="folders">Folders</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconTip label="Add project">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-sidebar-muted-foreground"
              aria-label="Add project"
              disabled={connection.state !== "connected"}
              onClick={openNewProject}
            >
              <FolderPlus />
            </Button>
          </IconTip>
          <IconTip label={withShortcut("New thread", newThreadKey)}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-sidebar-muted-foreground"
              aria-label="New thread"
              onClick={startNewThread}
            >
              <SquarePen />
            </Button>
          </IconTip>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className={cn("px-1 pt-0", layout === "folders" && "gap-0.5")}>
          {cards && (
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {cardList.map((t) => (
                  <ThreadTile
                    key={t.id}
                    thread={t}
                    project={projectNames.get(t.projectId) ?? "General"}
                    active={t.id === activeThreadId}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
          {!cards && groups.map(({ project: p, threads, all }) =>
            flat ? (
              <SidebarGroupContent key={p.id}>
                <SidebarMenu>
                  {threads.map((t) => (
                    <ThreadRow key={t.id} thread={t} active={t.id === activeThreadId} place={profile?.name} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            ) : layout === "folders" ? (
              <ProjectFolder
                key={p.id}
                project={p}
                threads={threads}
                allThreads={all}
                open={isOpen(p.id)}
                onToggle={() => toggleCollapsed(p.id)}
                activeThreadId={activeThreadId}
                showEmpty={connection.state === "connected"}
                place={profile?.name}
              />
            ) : (
              <ProjectGroup
                key={p.id}
                project={p}
                threads={threads}
                allThreads={all}
                open={isOpen(p.id)}
                onToggle={() => toggleCollapsed(p.id)}
                activeThreadId={activeThreadId}
                showEmpty={connection.state === "connected"}
                place={profile?.name}
              />
            ),
          )}
          {shown.length === 0 && (flat || cards || searching) && connection.state === "connected" && (
            <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">
              {searching ? "No matching threads." : "No threads yet."}
            </p>
          )}
        </SidebarGroup>
      </SidebarContent>

      {/* Pinned below the scrolling thread list, so the nav is always in reach. */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={inRoutines} onClick={() => store.go({ kind: "routines" })}>
              <Repeat />
              <span>Routines</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={view.kind === "personalities"}
              onClick={() => store.go({ kind: "personalities" })}
            >
              <Users />
              <span>Personalities</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {doneCount > 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton isActive={view.kind === "done"} onClick={() => store.go({ kind: "done" })}>
                <Check />
                <span>Done</span>
                <span className="ml-auto text-xs text-sidebar-muted-foreground tabular-nums">{doneCount}</span>
                <ChevronRight className="text-sidebar-muted-foreground" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        <SidebarMenu className="flex-row items-center gap-1">
          <SidebarMenuItem className="min-w-0 flex-1">
            {connection.state === "connected" ? (
              // Profiles are Hermes profiles, switched and created here.
              <ProfilePicker side="top" render={<SidebarMenuButton title="Switch profile" />}>
                {profile && <ProjectBadge name={profile.name} className="size-4 rounded text-[0.5rem]" />}
                <span className="truncate">{profile?.name ?? "No profile"}</span>
                <ChevronsUpDown className="ml-auto text-sidebar-muted-foreground" />
              </ProfilePicker>
            ) : (
              // Only while Hermes is unreachable: when connected, the status says nothing.
              <SidebarMenuButton onClick={onOpenSettings}>
                <span
                  className={cn("size-2 rounded-full", connection.state === "error" ? "bg-destructive" : "bg-muted-foreground")}
                />
                <span className="truncate">{connection.state === "error" ? "Not connected" : "Connecting…"}</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
          <IconTip label={withShortcut("Settings", settingsKey)} side="top">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-sidebar-muted-foreground"
              aria-label="Settings"
              onClick={onOpenSettings}
            >
              <Settings />
            </Button>
          </IconTip>
          <ReconnectButton />
          {/* Shows only when there's an update to download or install. */}
          <UpdateButton />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** A thread in the sidebar list. In a project folder, `tinted` colors it with the folder. */
function ThreadRow({
  thread: t,
  active,
  place,
  tinted = false,
}: {
  thread: Thread
  active: boolean
  /** The profile's name, for the hover card. */
  place?: string
  tinted?: boolean
}) {
  const doneKey = useShortcutLabel("mark-done")
  const status = useStore((s) => shownStatus(t, s.subagents))
  return (
    <HoverCard>
      <HoverCardTrigger render={<SidebarMenuItem />}>
        <SidebarMenuButton
          isActive={active}
          onClick={() => store.go({ kind: "thread", threadId: t.id })}
          className={cn(
            "pr-2! data-active:font-normal",
            tinted
              ? // Dia-style: the active thread is a raised neutral tab sitting on the folder's color.
                "rounded-lg hover:bg-[oklch(0.62_0.17_var(--h)/0.12)] data-active:bg-white data-active:text-sidebar-foreground data-active:shadow-[0_1px_2px_oklch(0_0_0/0.08),0_0_0_1px_oklch(0_0_0/0.05)] dark:hover:bg-[oklch(0.62_0.17_var(--h)/0.16)] dark:data-active:bg-[oklch(0.16_0.012_var(--h)/0.9)] dark:data-active:text-white dark:data-active:shadow-[0_1px_3px_oklch(0_0_0/0.35),inset_0_0_0_1px_oklch(1_0_0/0.06)]"
              : "hover:bg-sidebar-row-hover data-active:bg-sidebar-accent",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          {!active && <DraftMark threadId={t.id} />}
          {/* On hover the done tick takes this spot, so the status steps aside
              (keeping its width, so the title doesn't reflow). */}
          <span className="ml-auto flex shrink-0 group-hover/menu-item:invisible">
            {status === "idle" ? (
              <span className="text-xs text-sidebar-muted-foreground tabular-nums">{relativeTime(t.updatedAt)}</span>
            ) : (
              <StatusPill status={status} stopping={t.stopping} />
            )}
          </span>
        </SidebarMenuButton>
        <SidebarMenuAction
          className="opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100"
          title={withShortcut("Mark as done", doneKey)}
          aria-label={`Mark “${t.title}” as done`}
          onClick={() => void backend.setDone(t.id, true)}
        >
          <Check />
        </SidebarMenuAction>
      </HoverCardTrigger>
      <HoverCardContent>
        <ThreadCard thread={t} place={place} />
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * A thread in the list layout, as a T3-style card: the project it's in and when it last
 * moved, then its title, then what it's up to (or your first message) and the model it runs on.
 */
function ThreadTile({ thread: t, project, active }: { thread: Thread; project: string; active: boolean }) {
  const doneKey = useShortcutLabel("mark-done")
  const status = useStore((s) => shownStatus(t, s.subagents))
  // The model picked in this app wins; otherwise what Hermes's list says it last ran on.
  const picked = useStore((s) => s.threadModels[t.id])
  const model = picked?.model ?? t.model
  const slug = `${picked?.provider ?? t.provider ?? ""}/${model ?? ""}`
  const unseen = useUnseen(t) && !active
  const Mark = providerIcon(slug)
  return (
    <SidebarMenuItem>
      <button
        type="button"
        data-active={active || undefined}
        onClick={() => store.go({ kind: "thread", threadId: t.id })}
        className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent"
      >
        <span className="flex h-5 items-center gap-2 text-xs text-sidebar-muted-foreground">
          <ProjectBadge name={project} />
          <span className="min-w-0 truncate">{project}</span>
          {/* On hover the done tick takes this spot. */}
          <span className="ml-auto shrink-0 tabular-nums group-hover/menu-item:invisible">{relativeTime(t.updatedAt)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">{t.title}</span>
          {!active && <DraftMark threadId={t.id} />}
        </span>
        <span className="flex h-4 items-center gap-2 text-xs text-sidebar-muted-foreground">
          <TileStatus status={status} stopping={t.stopping} unseen={unseen} />
          {/* At rest: the first thing you asked it. */}
          {status === "idle" && !unseen && t.preview && <span className="min-w-0 flex-1 truncate">{t.preview}</span>}
          {/* The model, with its provider's mark at the end, as T3 shows the agent's. */}
          {model && (
            <span title={modelName(model.split("/").pop()!)} className="ml-auto flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate">{shortModelName(model.split("/").pop()!)}</span>
              <Mark className={cn("size-4 shrink-0", providerTint(slug))} />
            </span>
          )}
        </span>
      </button>
      <SidebarMenuAction
        className="top-2! right-2! opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100"
        title={withShortcut("Mark as done", doneKey)}
        aria-label={`Mark “${t.title}” as done`}
        onClick={() => void backend.setDone(t.id, true)}
      >
        <Check />
      </SidebarMenuAction>
    </SidebarMenuItem>
  )
}

/** A card's bottom-left: what the thread is doing, else whether it has a reply you haven't seen. */
function TileStatus({ status, stopping, unseen }: { status: Thread["status"]; stopping?: boolean; unseen: boolean }) {
  if (status === "working")
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-update-foreground">
        <Spinner className="size-3" />
        {stopping ? "Stopping" : "Working"}
      </span>
    )
  if (status === "needs-you")
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-warning-foreground">
        <span className="size-1.5 rounded-full bg-warning" />
        Awaiting you
      </span>
    )
  if (unseen)
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-sidebar-foreground">
        <span className="size-1.5 rounded-full bg-primary" />
        New reply
      </span>
    )
  return null
}

const COLLAPSED_KEY = "kitab.sidebarCollapsedProjects"

/** Projects you've folded shut, per profile, on this device. */
function useCollapsedProjects(profileId: Id | null): [Set<Id>, (id: Id) => void] {
  const [all, setAll] = useState<Record<Id, Id[]>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}")
      return v && typeof v === "object" && !Array.isArray(v) ? v : {}
    } catch {
      return {}
    }
  })
  const set = useMemo(() => new Set(profileId ? (all[profileId] ?? []) : []), [all, profileId])
  const toggle = (id: Id) => {
    if (!profileId) return
    setAll((prev) => {
      const mine = new Set(prev[profileId] ?? [])
      if (mine.has(id)) mine.delete(id)
      else mine.add(id)
      const next = { ...prev, [profileId]: [...mine] }
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }
  return [set, toggle]
}

type GroupProps = {
  project: Project
  threads: Thread[]
  allThreads: Thread[]
  open: boolean
  onToggle: () => void
  activeThreadId: Id | null
  showEmpty: boolean
  /** The profile's name, for the thread cards. */
  place?: string
}

/** Opens a new thread in this project. */
function newThreadIn(p: Project) {
  backend.selectProject(p.id)
  store.go({ kind: "thread", threadId: null })
}

/** The … menu on a project: rename it or take it off the list. General has neither. */
function ProjectMoreMenu({ project: p, className }: { project: Project; className?: string }) {
  if (p.id === GENERAL) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button title={`${p.name} options`} aria-label={`${p.name} options`} className={className} />}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44" data-over-vibrancy>
        {p.folder && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-mono text-[0.7rem] font-normal break-all">{homePath(p.folder)}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(p.folder!)
                toast("Copied the folder's path")
              }}
            >
              <Copy />
              Copy folder path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => openRenameProject(p)}>
          <PenLine />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => void confirmRemoveProject(p)}>
          <Trash2 />
          Remove from list…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A project in the plain list: a small header that folds, with its threads below. */
function ProjectGroup({ project: p, threads, allThreads, open, onToggle, activeThreadId, showEmpty, place }: GroupProps) {
  const subagents = useStore((s) => s.subagents)
  const status = open ? "done" : aggregateStatus(allThreads.map((t) => ({ ...t, status: shownStatus(t, subagents) })))
  const action =
    "flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5"
  return (
    <div className="mt-1.5 first-of-type:mt-0">
      <div className="group/folder relative">
        <button
          onClick={onToggle}
          aria-expanded={open}
          title={p.folder ? `${p.name}\n${homePath(p.folder)}` : p.name}
          className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 pr-14 text-left text-xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <ChevronRight aria-hidden className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
          <span className="min-w-0 truncate">{p.name}</span>
          {status !== "done" && (
            <span className="ml-auto flex shrink-0 group-hover/folder:invisible">
              <StatusPill status={status} />
            </span>
          )}
        </button>
        <div className="absolute top-0.5 right-1 flex gap-0.5 opacity-0 group-hover/folder:opacity-100 has-focus-visible:opacity-100 has-data-popup-open:opacity-100">
          <button title={`New thread in ${p.name}`} aria-label={`New thread in ${p.name}`} onClick={() => newThreadIn(p)} className={action}>
            <SquarePen />
          </button>
          <ProjectMoreMenu project={p} className={action} />
        </div>
      </div>
      {open && (
        <SidebarMenu>
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} active={t.id === activeThreadId} place={place} />
          ))}
          {threads.length === 0 && showEmpty && <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">No threads yet.</p>}
        </SidebarMenu>
      )}
    </div>
  )
}

/**
 * A project as a Dia-style folder: it takes its project's color and everything in it, open
 * or active, wears that color.
 */
function ProjectFolder({ project: p, threads, allThreads, open, onToggle, activeThreadId, showEmpty, place }: GroupProps) {
  const subagents = useStore((s) => s.subagents)
  // Collapsed, the folder still says if something in it is working or waiting on you.
  const status = open ? "done" : aggregateStatus(allThreads.map((t) => ({ ...t, status: shownStatus(t, subagents) })))
  const Icon = open ? FolderOpen : Folder

  return (
    <div
      style={{ "--h": hue(p.name) } as React.CSSProperties}
      className={cn(
        "rounded-xl border border-transparent px-1",
        // Open, the folder is a card in its color with a hairline edge.
        open &&
          "my-0.5 border-[oklch(0.62_0.17_var(--h)/0.2)] bg-[oklch(0.62_0.17_var(--h)/0.1)] py-1 dark:border-[oklch(0.72_0.12_var(--h)/0.18)] dark:bg-[oklch(0.5_0.11_var(--h)/0.24)]",
      )}
    >
      <div className="group/folder relative">
        <button
          onClick={onToggle}
          aria-expanded={open}
          title={p.folder ? `${p.name}\n${homePath(p.folder)}` : p.name}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 pr-14 text-left text-sm outline-none hover:bg-[oklch(0.62_0.17_var(--h)/0.1)] focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon className="size-4 shrink-0 fill-[oklch(0.62_0.17_var(--h)/0.28)] text-[oklch(0.55_0.17_var(--h))] dark:text-[oklch(0.76_0.14_var(--h))]" />
          <span className="min-w-0 truncate font-medium text-[oklch(0.38_0.1_var(--h))] dark:text-[oklch(0.82_0.1_var(--h))]">
            {p.name}
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-[oklch(0.55_0.12_var(--h)/0.8)] transition-transform dark:text-[oklch(0.76_0.1_var(--h)/0.8)]",
              open && "rotate-90",
            )}
          />
          {status !== "done" && (
            <span className="ml-auto flex shrink-0 group-hover/folder:invisible">
              <StatusPill status={status} />
            </span>
          )}
        </button>
        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover/folder:opacity-100 has-focus-visible:opacity-100 has-data-popup-open:opacity-100">
          <FolderAction label={`New thread in ${p.name}`} onClick={() => newThreadIn(p)}>
            <SquarePen />
          </FolderAction>
          <ProjectMoreMenu project={p} className={FOLDER_ACTION} />
        </div>
      </div>
      {open && (
        <SidebarMenu className="gap-0.5 pt-0.5 pl-4">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} tinted active={t.id === activeThreadId} place={place} />
          ))}
          {threads.length === 0 && showEmpty && (
            <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">No threads yet.</p>
          )}
        </SidebarMenu>
      )}
    </div>
  )
}

const FOLDER_ACTION =
  "flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-[oklch(0.62_0.17_var(--h)/0.16)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5"

function FolderAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={FOLDER_ACTION}
    >
      {children}
    </button>
  )
}

/** What a thread row's hover card shows: the full title, then where and who, then the latest words. */
function ThreadCard({ thread, place }: { thread: Thread; place?: string }) {
  const projectName = useStore((s) =>
    thread.projectId === GENERAL ? "General" : s.projects[thread.profileId]?.find((p) => p.id === thread.projectId)?.name,
  )
  const personalities = useStore((s) => s.personalities)
  const routines = useStore((s) => s.routines)
  const status = useStore((s) => shownStatus(thread, s.subagents))
  const cast = thread.cast
    .map((id) => personalities.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n)
  const routine = thread.fromRun && routines.find((r) => r.id === thread.fromRun!.routineId)

  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-medium leading-snug break-words">{thread.title}</div>
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {place && (
          <div className="flex items-center gap-2">
            <ProjectBadge name={place} className="size-4 rounded text-[0.5rem]" />
            <span className="truncate">
              {place}
              {projectName && ` · ${projectName}`}
            </span>
          </div>
        )}
        {cast.length > 0 && (
          <div className="flex items-center gap-2">
            <Users className="size-3.5 shrink-0" />
            <span className="truncate">{cast.join(", ")}</span>
          </div>
        )}
        {routine && (
          <div className="flex items-center gap-2">
            <Repeat className="size-3.5 shrink-0" />
            <span className="truncate">From {routine.name}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 shrink-0" />
          <span className="truncate">Updated {relativeTime(thread.updatedAt)}</span>
          {status !== "idle" && <StatusPill status={status} stopping={thread.stopping} className="ml-auto" />}
        </div>
      </div>
      {thread.preview && (
        <p className="line-clamp-3 border-t border-foreground/10 pt-2.5 text-xs leading-relaxed text-muted-foreground">
          {thread.preview}
        </p>
      )}
    </div>
  )
}

/** Shows while not connected: tries to reach Hermes again now instead of waiting for the next retry. */
function ReconnectButton() {
  const connection = useStore((s) => s.connection)
  const [retrying, setRetrying] = useState(false)
  if (connection.state !== "error" && !retrying) return null

  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await reconnectNow()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Reconnect"
            aria-disabled={retrying || undefined}
            onClick={retry}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-control text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              retrying ? "cursor-default" : "cursor-pointer hover:bg-sidebar-row-hover",
            )}
          />
        }
      >
        <RotateCw className={cn("size-4", retrying && "animate-spin")} />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {retrying ? "Reconnecting…" : connection.state === "error" ? `Reconnect · ${connection.message}` : "Reconnect"}
      </TooltipContent>
    </Tooltip>
  )
}

function IconTip({
  label,
  side = "bottom",
  children,
}: {
  label: string
  side?: "top" | "bottom"
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Looks like a label until clicked, then filters threads by title. Esc clears. */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const active = editing || value !== ""

  return (
    <div
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground hover:bg-sidebar-row-hover has-focus:bg-sidebar-control"
      onClick={() => {
        setEditing(true)
        requestAnimationFrame(() => input.current?.focus())
      }}
    >
      <Search className="size-4 shrink-0" />
      {active ? (
        <input
          ref={input}
          value={value}
          placeholder="Search"
          aria-label="Search threads"
          className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => value === "" && setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onChange("")
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
        />
      ) : (
        <span className="text-sm">Search</span>
      )}
      {value !== "" && (
        <button
          aria-label="Clear search"
          className="shrink-0 rounded-sm p-0.5 hover:text-sidebar-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onChange("")
            setEditing(false)
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** Something you wrote in this thread and haven't sent yet. */
function DraftMark({ threadId }: { threadId: Id }) {
  if (!useHasDraft(threadId)) return null
  return (
    <span title="Unsent draft" aria-label="Unsent draft" className="flex shrink-0 text-sidebar-muted-foreground">
      <PenLine className="size-3.5" />
    </span>
  )
}
