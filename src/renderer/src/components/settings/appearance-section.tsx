import { useState } from "react"
import { toast } from "sonner"
import { ListChecks, Paintbrush, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { exportThemeFile } from "@/lib/appearance/import"
import {
  appearance,
  DEFAULTS,
  resolved,
  THREAD_DETAIL_ITEMS,
  useAppearance,
  variantFor,
  type AppearanceSettings,
  type ChatWidth,
  type ColorScheme,
  type SidebarLayout,
} from "@/lib/appearance/store"
import { slug, type ThemeFamily } from "@/lib/appearance/tokens"
import { cn } from "@/lib/utils"
import { AddThemeDialog } from "./add-theme-dialog"
import { FontPicker } from "./font-picker"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"
import { SchemePreview, ThemeCard } from "./theme-card"
import { store } from "@/lib/store"

export function AppearanceSection() {
  const settings = useAppearance((s) => s.settings)
  const custom = useAppearance((s) => s.custom)
  const [adding, setAdding] = useState(false)
  const families = [...appearance.families()]
  const active = resolved().family

  // The editor floats over the app (not this overlay) so every change previews live.
  const setEditing = (target: { family: ThemeFamily | null; isNew: boolean }) => {
    store.set({ settings: null })
    appearance.openEditor(target)
  }
  const set = (patch: Partial<AppearanceSettings>) => appearance.update(patch)
  const resetIf = (key: keyof AppearanceSettings) =>
    JSON.stringify(settings[key]) !== JSON.stringify(DEFAULTS[key]) ? () => appearance.reset([key]) : undefined

  const duplicate = (f: ThemeFamily) => {
    const copy: ThemeFamily = {
      id: `${slug(f.name)}-copy-${Math.random().toString(36).slice(2, 7)}`,
      name: `${f.name} copy`,
      variants: f.variants.map((v) => ({ ...v, colors: { ...v.colors, ...(f.native ? nativeSidebar(v.colors) : {}) } })),
    }
    appearance.saveCustom(copy)
    appearance.useTheme(copy.id)
    setEditing({ family: copy, isNew: false })
  }

  const exportFamily = async (f: ThemeFamily) => {
    if (await window.hermes.themes.export(`${slug(f.name)}.kitab-theme.json`, exportThemeFile(f))) toast.success("Theme exported")
  }

  const remove = (f: ThemeFamily) => {
    if (!window.confirm(`Remove “${f.name}”? This can't be undone.`)) return
    appearance.removeCustom(f.id)
  }

  return (
    <>
      <SettingsGroup title="Color scheme">
        <div className="grid grid-cols-3 gap-4">
          {(["system", "light", "dark"] as ColorScheme[]).map((scheme) => (
            <SchemeCard key={scheme} scheme={scheme} family={active} selected={settings.scheme === scheme} />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Themes"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing({ family: null, isNew: true })}>
              <Paintbrush />
              Create theme
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add theme
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {families.map((f) => (
            <ThemeCard
              key={f.id}
              family={f}
              active={f.id === active.id}
              onDuplicate={() => duplicate(f)}
              onEdit={() => setEditing({ family: f, isNew: false })}
              onExport={() => void exportFamily(f)}
              onDelete={() => remove(f)}
            />
          ))}
        </div>
        {custom.length === 0 && (
          <p className="mt-3 px-1 text-xs text-muted-foreground">
            Create your own from two colors, or add one of thousands of VS Code themes from Open VSX.
          </p>
        )}
      </SettingsGroup>

      <SettingsGroup title="Interface">
        <SettingsCard>
          <SettingRow
            label="Contrast"
            description="Adjust the contrast of colors and borders across the interface."
            onReset={resetIf("contrast")}
          >
            <RangeControl value={settings.contrast} min={0} max={200} step={5} unit="%" onChange={(v) => set({ contrast: v })} />
          </SettingRow>
          <SettingRow
            label="Glass opacity"
            description="Higher values make menus, dialogs, the composer and a themed sidebar more solid."
            onReset={resetIf("glassOpacity")}
          >
            <RangeControl value={settings.glassOpacity} min={40} max={100} step={5} unit="%" onChange={(v) => set({ glassOpacity: v })} />
          </SettingRow>
          <SettingRow label="Panel animations" description="Set how fast panels open and close." onReset={resetIf("panelAnimationMs")}>
            <RangeControl
              value={settings.panelAnimationMs}
              min={0}
              max={500}
              step={25}
              format={(v) => (v === 0 ? "Off" : `${v} ms`)}
              onChange={(v) => set({ panelAnimationMs: v })}
            />
          </SettingRow>
          <SettingRow label="Chat width" description="Set how wide messages and the composer can grow on large screens.">
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[settings.chatWidth]}
              onValueChange={(v: string[]) => v[0] && set({ chatWidth: v[0] as ChatWidth })}
            >
              <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
              <ToggleGroupItem value="wide">Wide</ToggleGroupItem>
              <ToggleGroupItem value="full">Full</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label="Projects in the sidebar"
            description="A list shows every thread in the open profile as one list, each saying which project it's in. Folders show each project as a card in its own color, with its threads inside."
          >
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[settings.sidebarLayout]}
              onValueChange={(v: string[]) => v[0] && set({ sidebarLayout: v[0] as SidebarLayout })}
            >
              <ToggleGroupItem value="switcher">List</ToggleGroupItem>
              <ToggleGroupItem value="folders">Folders</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
          <SettingRow
            label="Thread details"
            description="Choose what the thread details card shows. You can also right-click the card."
          >
            <ThreadDetailsPicker />
          </SettingRow>
          <SettingRow label="Word wrapping" description="Wrap long lines in code blocks by default.">
            <Switch checked={settings.wordWrap} onCheckedChange={(v) => set({ wordWrap: v })} />
          </SettingRow>
          <SettingRow label="Font smoothing" description="Use thinner grayscale text smoothing instead of the macOS default.">
            <Switch checked={settings.fontSmoothing} onCheckedChange={(v) => set({ fontSmoothing: v })} />
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsCard>
          <SettingRow
            label="Interface font size"
            description="Everything outside code blocks. Scales the whole app."
            onReset={resetIf("fontSizeInterface")}
          >
            <SizeControl value={settings.fontSizeInterface} min={12} max={20} onChange={(v) => set({ fontSizeInterface: v })} />
          </SettingRow>
          <SettingRow
            label="Prompt font size"
            description="Only the box you write prompts in."
            onReset={resetIf("fontSizePrompt")}
          >
            <SizeControl value={settings.fontSizePrompt} min={11} max={22} onChange={(v) => set({ fontSizePrompt: v })} />
          </SettingRow>
          <SettingRow label="Code font size" description="Code blocks and inline code in messages." onReset={resetIf("fontSizeCode")}>
            <SizeControl value={settings.fontSizeCode} min={10} max={20} onChange={(v) => set({ fontSizeCode: v })} />
          </SettingRow>
          <SettingRow label="Interface font" description="The font for menus, the sidebar and messages." onReset={resetIf("fontFamilySans")}>
            <FontPicker value={settings.fontFamilySans} onChange={(v) => set({ fontFamilySans: v })} placeholder="SF Pro (system)" />
          </SettingRow>
          <SettingRow label="Prompt font" description="Only the box you write prompts in. Mono works well here." onReset={resetIf("fontFamilyComposer")}>
            <FontPicker value={settings.fontFamilyComposer} onChange={(v) => set({ fontFamilyComposer: v })} placeholder="Same as interface" />
          </SettingRow>
          <SettingRow label="Monospace font" description="Code blocks and inline code." onReset={resetIf("fontFamilyCode")}>
            <FontPicker
              value={settings.fontFamilyCode}
              monospaceOnly
              onChange={(v) => set({ fontFamilyCode: v })}
              placeholder="SF Mono (system)"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>

      <AddThemeDialog open={adding} onOpenChange={setAdding} />
    </>
  )
}

/** Kitaab's own palette has a see-through sidebar; a copy gets a painted one so it can be edited. */
function nativeSidebar(colors: ThemeFamily["variants"][number]["colors"]) {
  return colors.sidebar === "transparent" ? { sidebar: colors.surfaceRaised } : {}
}

function SchemeCard({ scheme, family, selected }: { scheme: ColorScheme; family: ThemeFamily; selected: boolean }) {
  const light = variantFor(family, "light").colors
  const dark = variantFor(family, "dark").colors
  return (
    <button
      onClick={() => appearance.update({ scheme })}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border bg-card p-2 pb-2.5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-primary/60 ring-1 ring-primary/40",
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border">
        {scheme === "system" ? (
          <>
            <div className="absolute inset-0">
              <SchemePreview colors={dark} />
            </div>
            <div className="absolute inset-0 [clip-path:polygon(0_0,50%_0,50%_100%,0_100%)]">
              <SchemePreview colors={light} />
            </div>
          </>
        ) : (
          <SchemePreview colors={scheme === "light" ? light : dark} />
        )}
      </div>
      <span className="text-sm">{scheme === "system" ? "System" : scheme === "light" ? "Light" : "Dark"}</span>
    </button>
  )
}

function RangeControl({
  value,
  min,
  max,
  step,
  unit = "",
  format,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  unit?: string
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex w-64 items-center gap-3">
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
      />
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {format ? format(value) : `${value}${unit}`}
      </span>
    </div>
  )
}

function SizeControl({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border">
      <Button variant="ghost" size="icon-sm" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Smaller">
        −
      </Button>
      <span className="w-12 text-center text-sm tabular-nums">{value}px</span>
      <Button variant="ghost" size="icon-sm" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Larger">
        +
      </Button>
    </div>
  )
}

function ThreadDetailsPicker() {
  const items = useAppearance((s) => s.settings.threadDetails)
  const shown = THREAD_DETAIL_ITEMS.filter(([k]) => items[k]).length
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <ListChecks />
        {shown} of {THREAD_DETAIL_ITEMS.length} shown
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 gap-0 p-1">
        {THREAD_DETAIL_ITEMS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            {label}
            <Switch
              size="sm"
              checked={items[key]}
              onCheckedChange={(v) => appearance.update({ threadDetails: { ...items, [key]: v } })}
            />
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}
