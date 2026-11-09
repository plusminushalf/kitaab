import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { shortcuts, useShortcutBindings } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"
import {
  acceleratorFromEvent,
  acceleratorKeys,
  bindingProblem,
  FIXED_SHORTCUTS,
  SHORTCUTS,
  type ShortcutGroup,
  type ShortcutId,
} from "../../../../shared/shortcuts"
import { SettingsCard, SettingsGroup } from "./settings-page"

const GROUPS: ShortcutGroup[] = ["General", "Threads", "Find", "Navigation", "Composer"]

/**
 * Every shortcut in one place (T3 Code's Keybindings page, named for what people call
 * them). Click a shortcut and press a new one; ⌫ removes it, Esc keeps the old one.
 */
export function ShortcutsSection() {
  const bindings = useShortcutBindings()
  const overrides = shortcuts.overrides()
  const [query, setQuery] = useState("")
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const matches = (label: string, keys: string[]) =>
    !q || label.toLowerCase().includes(q) || keys.join("").toLowerCase().includes(q)

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        editable: SHORTCUTS.filter((s) => s.group === group && matches(s.label, acceleratorKeys(bindings[s.id]))),
        fixed: FIXED_SHORTCUTS.filter((s) => s.group === group && matches(s.label, s.keys)),
      })).filter((g) => g.editable.length || g.fixed.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, bindings],
  )

  // While recording, the menu bar lets go of its shortcuts so the keys reach the page.
  useEffect(() => {
    if (!recording) return
    window.hermes.shortcuts.pause(true)
    const stop = () => {
      setRecording(null)
      setProblem(null)
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      if (bare && e.key === "Escape") return stop()
      if (bare && (e.key === "Backspace" || e.key === "Delete")) {
        void shortcuts.set(recording, "")
        return stop()
      }
      const accelerator = acceleratorFromEvent(e)
      if (!accelerator) return
      const why = bindingProblem(accelerator, recording, shortcuts.bindings())
      if (why) return setProblem(why)
      void shortcuts.set(recording, accelerator)
      stop()
    }
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-recording]`)) stop()
    }
    window.addEventListener("keydown", onKey, true)
    document.addEventListener("pointerdown", onDown, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      document.removeEventListener("pointerdown", onDown, true)
      window.hermes.shortcuts.pause(false)
    }
  }, [recording])

  const changed = Object.keys(overrides).length > 0

  return (
    <>
      <div className="mb-8 flex items-center gap-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder"
          />
        </label>
        <Button variant="outline" disabled={!changed} onClick={() => void shortcuts.resetAll()}>
          Reset all
        </Button>
      </div>

      {groups.length === 0 && <p className="px-1 text-sm text-muted-foreground">No shortcuts match “{query}”.</p>}

      {groups.map(({ group, editable, fixed }) => (
        <SettingsGroup key={group} title={group}>
          <SettingsCard>
            {editable.map((s) => {
              const isRecording = recording === s.id
              const isChanged = s.id in overrides
              return (
                <div key={s.id} className="flex items-center gap-6 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {s.label}
                      {isChanged && (
                        <button
                          className="text-xs font-normal text-muted-foreground hover:text-foreground"
                          onClick={() => void shortcuts.reset(s.id)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    {isRecording && (
                      <div className={cn("mt-0.5 text-xs", problem ? "text-destructive" : "text-muted-foreground")}>
                        {problem ?? "Press the new shortcut · ⌫ removes it · Esc cancels"}
                      </div>
                    )}
                  </div>
                  <button
                    data-recording={isRecording ? "" : undefined}
                    onClick={() => {
                      setProblem(null)
                      setRecording(isRecording ? null : s.id)
                    }}
                    title={isRecording ? "Press keys…" : "Click to change"}
                    className={cn(
                      "flex h-8 min-w-20 shrink-0 items-center justify-end gap-1 rounded-md px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
                      isRecording && "bg-accent ring-2 ring-ring/50",
                    )}
                  >
                    {isRecording ? (
                      <span className="px-1 text-xs text-muted-foreground">Press keys…</span>
                    ) : bindings[s.id] ? (
                      <Keys keys={acceleratorKeys(bindings[s.id])} />
                    ) : (
                      <span className="px-1 text-xs text-muted-foreground">None</span>
                    )}
                  </button>
                </div>
              )
            })}
            {fixed.map((s) => (
              <div key={s.label} className="flex items-center gap-6 px-4 py-3" title="This one can't be changed">
                <div className="min-w-0 flex-1 text-sm font-medium">{s.label}</div>
                <div className="flex shrink-0 items-center gap-1 px-1.5 opacity-70">
                  <Keys keys={s.keys} />
                </div>
              </div>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ))}
    </>
  )
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((k, i) =>
        k === "…" ? (
          <span key={i} className="text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <kbd
            key={i}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border bg-muted/60 px-1.5 font-sans text-xs font-medium text-foreground/90 shadow-[0_1px_0_var(--border)]"
          >
            {k}
          </kbd>
        ),
      )}
    </>
  )
}
