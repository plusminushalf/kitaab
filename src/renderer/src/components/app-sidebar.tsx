import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronRight, ChevronsUpDown, Clock, Folder, FolderOpen, ListFilter, PenLine, Plus, Repeat, Search, Settings, SquarePen, Users, X } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { ProjectPicker } from "@/components/project-picker"
import { StatusMark } from "@/components/routine-views"
import { UpdateButton } from "@/components/update-button"
import { backend, setShownThreadOrder } from "@kitab/core/backend"
import { store, useStore } from "@/lib/store"
import { useHasDraft } from "@/lib/composer-drafts"
import { useThreadSwitching } from "@/lib/thread-switching"
import { appearance, useAppearance, type SidebarLayout } from "@/lib/appearance/store"
import { cn } from "@/lib/utils"
import { relativeTime } from "@kitab/core/format"
import { shownStatus } from "@kitab/core/subagents"
import type { Id, Project, Routine, Thread } from "@kitab/core/model"

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
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
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

  const project = projects.find((p) => p.id === projectId)
  const projectThreads = useMemo(() => allThreads.filter((t) => t.projectId === projectId), [allThreads, projectId])
  const threads = useMemo(() => arrange(projectThreads, query, sort), [projectThreads, query, sort])
  const layout = useAppearance((s) => s.settings.sidebarLayout)
  useEffect(() => setShownThreadOrder(threads.map((t) => t.id)), [threads])
  const activeThreadId = view.kind === "thread" ? view.threadId : null
  useThreadSwitching(threads, projectThreads)
  const inRoutines = view.kind === "routines" || view.kind === "routine" || view.kind === "run"

  return (
    <Sidebar>
      {/* Clear space for the traffic lights; the strip drags the window. */}
      <div className="app-drag h-[52px] shrink-0" />
      <SidebarHeader className="pt-0">
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
                  <DropdownMenuRadioItem value="switcher">A switcher</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="folders">Folders</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconTip label="New thread (⌘N)">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-sidebar-muted-foreground"
              aria-label="New thread"
              onClick={() => store.go({ kind: "thread", threadId: null })}
            >
              <SquarePen />
            </Button>
          </IconTip>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {layout === "folders" ? (
          <ProjectFolders query={query} sort={sort} activeThreadId={activeThreadId} />
        ) : (
          <SidebarGroup className="pt-0">
            {/* Projects are Hermes profiles, switched and created here. A label, not a row,
                so threads keep the full width. */}
            <ProjectPicker
              render={
                <button
                  className="mb-0.5 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title="Switch project"
                />
              }
            >
              {project && <ProjectBadge name={project.name} className="size-4 rounded text-[0.5rem]" />}
              <span className="min-w-0 flex-1 truncate text-left">{project?.name ?? "No project"}</span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-70" />
            </ProjectPicker>
            <SidebarGroupContent>
              <SidebarMenu>
                {threads.map((t) => (
                  <ThreadRow key={t.id} thread={t} active={t.id === activeThreadId} projectName={project?.name} />
                ))}
                {threads.length === 0 && connection.state === "connected" && (
                  <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">
                    {query.trim() ? "No matching threads." : "No threads yet."}
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <LatestRuns projectId={projectId} activeRoutineId={view.kind === "run" ? view.routineId : null} />

        <SidebarGroup>
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
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="flex-row items-center gap-1">
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton onClick={onOpenSettings}>
              <span
                className={
                  "size-2 rounded-full " +
                  (connection.state === "connected"
                    ? "bg-green-500"
                    : connection.state === "error"
                      ? "bg-destructive"
                      : "bg-muted-foreground")
                }
              />
              <span className="truncate">
                {connection.state === "connected"
                  ? connection.server
                  : connection.state === "error"
                    ? "Not connected"
                    : "Connecting…"}
              </span>
              <Settings className="ml-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Shows only when there's an update to download or install. */}
          <UpdateButton />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

/** A thread in the sidebar list. In a project folder, `tinted` colors it with the folder. */
function ThreadRow({
  thread: t,
  active,
  projectName,
  tinted = false,
  onOpen,
}: {
  thread: Thread
  active: boolean
  projectName?: string
  tinted?: boolean
  onOpen?: () => void
}) {
  const status = useStore((s) => shownStatus(t, s.subagents))
  return (
    <HoverCard>
      <HoverCardTrigger render={<SidebarMenuItem />}>
        <SidebarMenuButton
          isActive={active}
          onClick={onOpen ?? (() => store.go({ kind: "thread", threadId: t.id }))}
          className={cn(
            "pr-2! data-active:font-normal",
            tinted
              ? "hover:bg-[oklch(0.62_0.17_var(--h)/0.12)] data-active:bg-[oklch(0.62_0.17_var(--h)/0.2)] data-active:text-[oklch(0.4_0.14_var(--h))] dark:hover:bg-[oklch(0.62_0.17_var(--h)/0.14)] dark:data-active:bg-[oklch(0.62_0.17_var(--h)/0.26)] dark:data-active:text-[oklch(0.9_0.07_var(--h))]"
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
          title="Mark as done (⇧⌘S)"
          aria-label={`Mark “${t.title}” as done`}
          onClick={() => void backend.setDone(t.id, true)}
        >
          <Check />
        </SidebarMenuAction>
      </HoverCardTrigger>
      <HoverCardContent>
        <ThreadCard thread={t} projectName={projectName} />
      </HoverCardContent>
    </HoverCard>
  )
}

const OPEN_FOLDERS_KEY = "kitab.sidebarOpenFolders"

function readOpenFolders(): Set<Id> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? "[]")
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

/**
 * Every project as a folder of its threads, Dia-style: each folder takes its project's color
 * and everything in it, open or active, wears that color. The open project's folder is
 * always open; a thread in another folder opens that project. Searching opens every folder
 * with a match and hides the rest.
 */
function ProjectFolders({ query, sort, activeThreadId }: { query: string; sort: Sort; activeThreadId: Id | null }) {
  const projects = useStore((s) => s.projects)
  const projectId = useStore((s) => s.projectId)
  const allThreads = useStore((s) => s.threads)
  const connected = useStore((s) => s.connection.state === "connected")
  const [open, setOpen] = useState<Set<Id>>(readOpenFolders)
  const searching = query.trim() !== ""

  const toggle = (id: Id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...next]))
      } catch {}
      return next
    })

  // Other projects' threads load the first time their folder opens (all of them, to search).
  const requested = useRef(new Set<Id>())
  useEffect(() => {
    if (!connected) {
      requested.current.clear()
      return
    }
    for (const p of projects) {
      if (p.id === projectId || requested.current.has(p.id)) continue
      if (!searching && !open.has(p.id)) continue
      requested.current.add(p.id)
      backend.loadProjectThreads(p.id).catch(() => requested.current.delete(p.id))
    }
  }, [connected, projects, projectId, open, searching])

  const byProject = useMemo(() => {
    const m = new Map<Id, Thread[]>()
    for (const t of allThreads) m.set(t.projectId, [...(m.get(t.projectId) ?? []), t])
    return m
  }, [allThreads])

  const folders = projects
    .map((p) => ({ project: p, threads: arrange(byProject.get(p.id) ?? [], query, sort) }))
    .filter((f) => !searching || f.threads.length > 0)

  return (
    <SidebarGroup className="gap-0.5 pt-0">
      {folders.map(({ project: p, threads }) => (
        <ProjectFolder
          key={p.id}
          project={p}
          threads={threads}
          allThreads={byProject.get(p.id) ?? []}
          current={p.id === projectId}
          open={searching || p.id === projectId || open.has(p.id)}
          onToggle={() => toggle(p.id)}
          activeThreadId={activeThreadId}
          showEmpty={connected}
        />
      ))}
      {searching && folders.length === 0 && (
        <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">No matching threads.</p>
      )}
      <ProjectPicker
        create
        render={
          <button className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
        }
      >
        <Plus className="size-4 shrink-0" />
        <span className="truncate">New project</span>
      </ProjectPicker>
    </SidebarGroup>
  )
}

function ProjectFolder({
  project: p,
  threads,
  allThreads,
  current,
  open,
  onToggle,
  activeThreadId,
  showEmpty,
}: {
  project: Project
  threads: Thread[]
  allThreads: Thread[]
  current: boolean
  open: boolean
  onToggle: () => void
  activeThreadId: Id | null
  showEmpty: boolean
}) {
  const subagents = useStore((s) => s.subagents)
  // Collapsed, the folder still says if something in it is working or waiting on you.
  const status = open ? "done" : aggregateStatus(allThreads.map((t) => ({ ...t, status: shownStatus(t, subagents) })))
  const Icon = open ? FolderOpen : Folder

  /** Opens a thread (or a new one, for null) in this project, switching to it first. */
  const openThread = (threadId: Id | null) => {
    if (!current) void backend.selectProject(p.id)
    store.go({ kind: "thread", threadId })
  }

  return (
    <div
      style={{ "--h": hue(p.name) } as React.CSSProperties}
      className={cn("rounded-lg", open && "bg-[oklch(0.62_0.17_var(--h)/0.06)] pb-1 dark:bg-[oklch(0.62_0.17_var(--h)/0.09)]")}
    >
      <div className="group/folder relative">
        <button
          onClick={onToggle}
          aria-expanded={open}
          title={current ? `${p.name} (open project)` : p.name}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 pr-14 text-left text-sm outline-none hover:bg-[oklch(0.62_0.17_var(--h)/0.1)] focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon className="size-4 shrink-0 fill-[oklch(0.62_0.17_var(--h)/0.28)] text-[oklch(0.55_0.17_var(--h))] dark:text-[oklch(0.76_0.14_var(--h))]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[oklch(0.38_0.1_var(--h))] dark:text-[oklch(0.9_0.06_var(--h))]">
            {p.name}
          </span>
          {status !== "done" && (
            <span className="flex shrink-0 group-hover/folder:invisible">
              <StatusPill status={status} />
            </span>
          )}
        </button>
        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover/folder:opacity-100 has-focus-visible:opacity-100">
          <FolderAction label={`New thread in ${p.name}`} onClick={() => openThread(null)}>
            <SquarePen />
          </FolderAction>
          <FolderAction
            label={`${p.name} settings`}
            onClick={() => {
              if (!current) void backend.selectProject(p.id)
              store.go({ kind: "project" })
            }}
          >
            <Settings />
          </FolderAction>
        </div>
      </div>
      {open && (
        <SidebarMenu className="px-1">
          {threads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              tinted
              active={current && t.id === activeThreadId}
              projectName={p.name}
              onOpen={() => openThread(t.id)}
            />
          ))}
          {threads.length === 0 && showEmpty && (
            <p className="px-2 py-1 text-xs text-sidebar-muted-foreground">No threads yet.</p>
          )}
        </SidebarMenu>
      )}
    </div>
  )
}

function FolderAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-[oklch(0.62_0.17_var(--h)/0.16)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5"
    >
      {children}
    </button>
  )
}

const LATEST_RUNS = 4

/** The project's most recent routine runs, newest first. A row opens that run's report. */
function LatestRuns({ projectId, activeRoutineId }: { projectId: Id | null; activeRoutineId: Id | null }) {
  const all = useStore((s) => s.routines)
  const recent = useMemo(
    () =>
      all
        .filter((r) => r.projectId === projectId && (r.running || r.lastRunAt))
        .sort((a, b) => Number(!!b.running) - Number(!!a.running) || (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
        .slice(0, LATEST_RUNS),
    [all, projectId],
  )

  const viewingAll = useStore((s) => s.view.kind === "runs")

  // Pinned to the bottom with the nav below it, so the thread list keeps the space above.
  if (recent.length === 0) return <div className="mt-auto" />

  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupLabel className="pr-1 text-sidebar-muted-foreground">
        <span className="flex-1">Latest runs</span>
        <button
          onClick={() => store.go({ kind: "runs" })}
          className={
            "rounded px-1.5 py-0.5 text-xs font-normal outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring " +
            (viewingAll ? "text-sidebar-foreground" : "text-sidebar-muted-foreground")
          }
        >
          View all
        </button>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recent.map((r) => (
            <SidebarMenuItem key={r.id}>
              <SidebarMenuButton
                isActive={r.id === activeRoutineId}
                onClick={() => void openLatestRun(r)}
                title={r.lastError && r.lastStatus === "failed" ? `${r.name}\n${r.lastError}` : r.name}
                className="pr-2! hover:bg-sidebar-row-hover data-active:bg-sidebar-accent data-active:font-normal"
              >
                <StatusMark
                  state={r.running ? "running" : r.lastStatus === "failed" ? "failed" : "ok"}
                  className="-ml-0.5 size-4"
                />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="ml-auto shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">
                  {r.running ? "Running" : relativeTime(r.lastRunAt!)}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Opens the routine's newest run, or the routine itself if its runs can't be listed. */
async function openLatestRun(r: Routine) {
  try {
    await backend.loadRuns(r.id)
  } catch {}
  const runs = store.get().runs[r.id] ?? []
  const latest = runs.reduce<(typeof runs)[number] | undefined>((a, b) => (!a || b.startedAt > a.startedAt ? b : a), undefined)
  store.go(latest ? { kind: "run", routineId: r.id, runId: latest.id } : { kind: "routine", routineId: r.id })
}

/** What a thread row's hover card shows: the full title, then where and who, then the latest words. */
function ThreadCard({ thread, projectName }: { thread: Thread; projectName?: string }) {
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
        {projectName && (
          <div className="flex items-center gap-2">
            <ProjectBadge name={projectName} className="size-4 rounded text-[0.5rem]" />
            <span className="truncate">{projectName}</span>
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

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{label}</TooltipContent>
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
