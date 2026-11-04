import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ChevronDown, ChevronUp, Moon, Sun, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toHex } from "@/lib/appearance/color"
import { appearance, resolved, variantFor } from "@/lib/appearance/store"
import {
  derivePalette,
  slug,
  TOKEN_GROUPS,
  type ThemeColors,
  type ThemeFamily,
  type ThemeVariant,
  type TokenName,
} from "@/lib/appearance/tokens"
import { cn } from "@/lib/utils"

export type EditorTarget = { family: ThemeFamily | null; isNew: boolean }
type Modes = "both" | "light" | "dark"

const seedOf = (colors: ThemeColors) => ({ background: toHex(colors.canvas), accent: toHex(colors.accent) })

function starterVariants(): ThemeVariant[] {
  // Start from what's on screen, so "create" feels like tweaking the current look.
  const family = resolved().family
  return (["light", "dark"] as const).map((mode) => {
    const seed = seedOf(variantFor(family, mode).colors)
    // Kitab's accent is near-black/white; give a fresh theme a real accent to start from.
    const accent = family.native ? (mode === "dark" ? "#7aa2f7" : "#3b6fe0") : seed.accent
    return { id: mode, name: mode === "dark" ? "Dark" : "Light", appearance: mode, colors: derivePalette(mode, seed.background, accent) }
  })
}

/** Floating editor; the app behind it previews every change live. */
export function ThemeEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const [name, setName] = useState(target.family?.name ?? "")
  const [variants, setVariants] = useState<ThemeVariant[]>(() => target.family?.variants.map((v) => ({ ...v, colors: { ...v.colors } })) ?? starterVariants())
  const [modes, setModes] = useState<Modes>("both")
  const [currentId, setCurrentId] = useState(() => variants.find((v) => v.appearance === resolved().appearance)?.id ?? variants[0].id)
  const [advanced, setAdvanced] = useState(!target.isNew)
  const [filter, setFilter] = useState("")
  const [minimized, setMinimized] = useState(false)

  const visible = target.isNew && modes !== "both" ? variants.filter((v) => v.appearance === modes) : variants
  const current = visible.find((v) => v.id === currentId) ?? visible[0]

  useEffect(() => {
    appearance.setPreview({ appearance: current.appearance, colors: current.colors })
  }, [current])
  useEffect(() => () => appearance.setPreview(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const patch = (colors: Partial<ThemeColors>) =>
    setVariants((all) => all.map((v) => (v.id === current.id ? { ...v, colors: { ...v.colors, ...colors } } : v)))

  const seed = seedOf(current.colors)
  const setSeed = (key: "background" | "accent", value: string) => {
    const next = { ...seed, [key]: value }
    patch(derivePalette(current.appearance, next.background, next.accent))
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("Name your theme first.")
      return
    }
    const family: ThemeFamily = {
      id: target.family && !target.family.builtIn ? target.family.id : `${slug(trimmed)}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed.slice(0, 48),
      source: target.family?.source,
      variants: visible,
    }
    appearance.saveCustom(family)
    appearance.useTheme(family.id, current)
    toast.success(target.isNew ? `${family.name} created` : `${family.name} saved`, { description: "It’s now active." })
    onClose()
  }

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return TOKEN_GROUPS.map((g) => ({
      ...g,
      tokens: g.tokens.filter(([k, label]) => !q || label.toLowerCase().includes(q) || k.toLowerCase().includes(q)),
    })).filter((g) => g.tokens.length)
  }, [filter])

  return (
    <div
      className={cn(
        "fixed right-4 bottom-4 z-50 flex w-[380px] flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl",
        "backdrop-blur-2xl",
        minimized ? "h-auto" : "top-16",
      )}
      data-slot="theme-editor"
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex-1 text-sm font-semibold">{target.isNew ? "Create theme" : "Edit theme"}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={minimized ? "Expand the theme editor" : "Minimize the theme editor"}
          onClick={() => setMinimized((m) => !m)}
        >
          {minimized ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close the theme editor" onClick={onClose}>
          <X />
        </Button>
      </div>

      {!minimized && (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="theme-name">Theme name</Label>
              <Input id="theme-name" autoFocus={target.isNew} value={name} placeholder="My theme" onChange={(e) => setName(e.target.value)} />
            </div>

            {target.isNew && (
              <div className="grid gap-1.5">
                <Label>Theme appearance</Label>
                <ToggleGroup variant="outline" size="sm" value={[modes]} onValueChange={(v: string[]) => v[0] && setModes(v[0] as Modes)}>
                  <ToggleGroupItem value="both">Light and dark</ToggleGroupItem>
                  <ToggleGroupItem value="light">Light</ToggleGroupItem>
                  <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}

            {visible.length > 1 && (
              <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                {visible.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setCurrentId(v.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground",
                      v.id === current.id && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    {v.appearance === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
                    {v.name}
                  </button>
                ))}
              </div>
            )}

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{advanced ? "Every color" : "Two colors, rest derived"}</span>
                <label className="flex items-center gap-2 text-xs">
                  Advanced
                  <Switch
                    size="sm"
                    checked={advanced}
                    onCheckedChange={(v) => {
                      setAdvanced(v)
                      // Leaving advanced rebuilds the palette from its two seed colors.
                      if (!v) patch(derivePalette(current.appearance, seed.background, seed.accent))
                    }}
                  />
                </label>
              </div>
              {!advanced ? (
                <>
                  <ColorField label="Background" value={current.colors.canvas} onChange={(v) => setSeed("background", v)} />
                  <ColorField label="Accent color" value={current.colors.accent} onChange={(v) => setSeed("accent", v)} />
                </>
              ) : (
                <>
                  <Input placeholder="Filter colors" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  {groups.map((g) => (
                    <div key={g.id} className="grid gap-2">
                      <div className="pt-1 text-xs font-medium text-muted-foreground">{g.label}</div>
                      {g.tokens.map(([key, label]) => (
                        <ColorField
                          key={key}
                          label={label}
                          value={current.colors[key as TokenName]}
                          onChange={(v) => patch({ [key]: v } as Partial<ThemeColors>)}
                        />
                      ))}
                    </div>
                  ))}
                  {groups.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
                </>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t p-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save}>{target.isNew ? "Create theme" : "Save changes"}</Button>
          </div>
        </>
      )}
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="flex items-center gap-2">
      <label
        className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs"
        style={{ background: value }}
        title="Choose a color"
      >
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={toHex(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Input
        className="h-7 w-40 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && text !== value && onChange(text.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

