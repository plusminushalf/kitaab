import { ModelPicker } from "@/components/model-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { backend } from "@kitab/core/backend"
import { EFFORT_LABELS, shortModelName } from "@kitab/core/model-names"
import { useStore, type SendMode } from "@/lib/store"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"

const SEND_MODES: { value: SendMode; label: string }[] = [
  { value: "queue", label: "Queue" },
  { value: "interrupt", label: "Interrupt" },
]

/** Defaults for new threads (T3 Code's Settings → Threads), and what sending does while a reply runs. */
export function ThreadsSection() {
  const mine = useStore((s) => s.myModel)
  const projectModel = useStore((s) => s.projectModel)
  const projectEffort = useStore((s) => s.projectEffort)
  const providers = useStore((s) => s.models)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))
  const enterSends = useStore((s) => s.enterSends)

  const available = mine ? providers.find((p) => p.slug === mine.provider)?.models.includes(mine.model) : true
  const projectLabel = projectModel
    ? `${shortModelName(projectModel.model)} ${EFFORT_LABELS[projectEffort] ?? projectEffort}`
    : "its own model"

  return (
    <>
      <SettingsGroup title="New threads">
        <SettingsCard>
          <SettingRow
            label="Model"
            onReset={mine ? () => void backend.setMyModel(null) : undefined}
            description={
              <>
                {mine
                  ? "Default model and reasoning for new threads in every project, on all your devices. The composer can still change it for one thread."
                  : `New threads use each project's own model${project ? ` (${project.name}: ${projectLabel})` : ""}. Pick one to use everywhere, on all your devices.`}
                {mine && !available && project && (
                  <span className="mt-1 block text-amber-600 dark:text-amber-400">
                    {project.name} can't run this model, so its threads use {projectLabel}.
                  </span>
                )}
              </>
            }
          >
            {providers.length ? (
              <ModelPicker
                value={mine ?? (projectModel ? { ...projectModel, effort: projectModel.effort ?? projectEffort } : null)}
                onChange={(choice) => void backend.setMyModel(choice)}
              />
            ) : (
              <span className="text-sm text-muted-foreground">Connect to choose a model</span>
            )}
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>
      <SettingsGroup title="Sending while a reply runs">
        <SettingsCard>
          <SettingRow
            label="Enter"
            description={
              enterSends === "queue"
                ? "Queue: your message waits and sends when the reply finishes. ⌘Enter interrupts the reply and sends now."
                : "Interrupt: the reply stops and your message sends now. ⌘Enter queues it until the reply finishes."
            }
          >
            <Select items={SEND_MODES} value={enterSends} onValueChange={(v) => v && backend.setEnterSends(v as SendMode)}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEND_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsCard>
      </SettingsGroup>
    </>
  )
}
