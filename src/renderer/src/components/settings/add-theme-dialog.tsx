import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Download, Palette, Search, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { familyFromVariants, parseThemeFile, variantFromVsCode } from "@/lib/appearance/import"
import { appearance, useAppearance } from "@/lib/appearance/store"
import type { ThemeFamily, ThemeVariant } from "@/lib/appearance/tokens"
import { parseJsonc } from "../../../../shared/jsonc"
import type { ThemeExtension, ThemeSearchSort } from "../../../../shared/bridge"

const SORTS: { value: ThemeSearchSort; label: string }[] = [
  { value: "relevance", label: "Most relevant" },
  { value: "downloadCount", label: "Most downloaded" },
  { value: "averageRating", label: "Best rated" },
  { value: "timestamp", label: "Newest" },
]

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })

/** "Add a theme": search VS Code color themes on Open VSX, or import a theme file. */
export function AddThemeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const custom = useAppearance((s) => s.custom)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<ThemeSearchSort>("downloadCount")
  const [results, setResults] = useState<ThemeExtension[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [json, setJson] = useState("")
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let stale = false
    setError(null)
    const t = setTimeout(() => {
      window.hermes.themes
        .search(query, sort)
        .then((r) => !stale && setResults(r))
        .catch((e) => !stale && setError(String(e?.message ?? e)))
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [open, query, sort])

  const added = (family: ThemeFamily) => {
    appearance.saveCustom(family)
    appearance.useTheme(family.id)
    toast.success(`${family.name} added`, { description: "It’s now active." })
    onOpenChange(false)
  }

  const install = async (ext: ThemeExtension) => {
    const key = `${ext.namespace}.${ext.name}`
    setInstalling(key)
    try {
      const { displayName, themes } = await window.hermes.themes.install(ext.namespace, ext.name)
      const variants: ThemeVariant[] = []
      for (const t of themes) {
        try {
          const v = variantFromVsCode(parseJsonc(t.json) as Record<string, unknown>, t.label, t.uiTheme)
          variants.push({ ...v, name: t.label })
        } catch {}
      }
      if (!variants.length) throw new Error("None of its themes have the colors Kitaab needs.")
      const source = `open-vsx:${key}`
      const existing = custom.find((f) => f.source === source)
      const family = familyFromVariants(displayName, variants, source)
      added(existing ? { ...family, id: existing.id } : family)
    } catch (e) {
      toast.error("Couldn’t add that theme", { description: String((e as Error)?.message ?? e) })
    } finally {
      setInstalling(null)
    }
  }

  const importText = (text: string, fileName?: string) => {
    try {
      added(parseThemeFile(text, fileName))
    } catch (e) {
      toast.error("Couldn’t import that theme", { description: String((e as Error)?.message ?? e) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a theme</DialogTitle>
          <DialogDescription>Find open-source VS Code color themes from Open VSX, or import a theme file.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus className="pl-8" placeholder="Search community themes" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select items={SORTS} value={sort} onValueChange={(v) => v && setSort(v as ThemeSearchSort)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="-mx-1 min-h-48 flex-1 overflow-y-auto px-1">
          {error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Open VSX didn’t answer: {error}. Try again.</p>
          ) : results === null ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No supported open-source themes found. Try a broader search.
            </div>
          ) : (
            <ul className="divide-y rounded-xl border">
              {results.map((ext) => {
                const key = `${ext.namespace}.${ext.name}`
                const installed = custom.some((f) => f.source === `open-vsx:${key}`)
                return (
                  <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                    {ext.iconUrl ? (
                      <img src={ext.iconUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Palette className="size-4 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium">{ext.displayName}</span>
                        <span className="truncate text-xs text-muted-foreground">{ext.namespace}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {ext.description || "A community color theme for your editor."}
                      </div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums sm:flex">
                      {ext.downloadCount != null && (
                        <span className="flex items-center gap-1">
                          <Download className="size-3" />
                          {compact.format(ext.downloadCount)}
                        </span>
                      )}
                      {ext.averageRating != null && (
                        <span className="flex items-center gap-1">
                          <Star className="size-3" />
                          {ext.averageRating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={installed ? "outline" : "default"}
                      disabled={installing !== null}
                      onClick={() => void install(ext)}
                    >
                      {installing === key ? <Spinner /> : installed ? "Update" : "Install"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">or import a file</span>
            <Button variant="outline" size="sm" onClick={() => picker.current?.click()}>
              Choose files
            </Button>
            <input
              ref={picker}
              type="file"
              accept=".json,.jsonc,application/json"
              multiple
              hidden
              onChange={async (e) => {
                for (const file of [...(e.target.files ?? [])]) importText(await file.text(), file.name)
                e.target.value = ""
              }}
            />
          </div>
          <Textarea
            className="h-20 font-mono text-xs"
            placeholder="Or paste theme JSON (Kitaab, T3 Code or VS Code)"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={!json.trim()} onClick={() => importText(json)}>
              Import JSON
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
