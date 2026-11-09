import { ModelPicker } from "@/components/model-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { backend } from "@kitab/core/backend"
import { EFFORT_LABELS, shortModelName } from "@kitab/core/model-names"
import { useStore, type SendMode } from "@/lib/store"
import { setCtrlTabMode, useCtrlTabMode, type CtrlTabMode } from "@/lib/thread-switching"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"

const SEND_MODES: { value: SendMode; label: string }[] = [
  { value: "queue", label: "Queue" },
  { value: "interrupt", label: "Interrupt" },
]

const CTRL_TAB_MODES: { value: CtrlTabMode; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "list", label: "List order" },
]

/** Defaults for new threads (T3 Code's Settings → Threads), and what sending does while a reply runs. */
export function ThreadsSection() {
  const mine = useStore((s) => s.myModel)
  const profileModel = useStore((s) => s.profileModel)
  const profileEffort = useStore((s) => s.profileEffort)
  const providers = useStore((s) => s.models)
  const profile = useStore((s) => s.profiles.find((p) => p.id === s.profileId))
  const enterSends = useStore((s) => s.enterSends)
  const ctrlTab = useCtrlTabMode()

  const available = mine ? providers.find((p) => p.slug === mine.provider)?.models.includes(mine.model) : true
  const profileLabel = profileModel
    ? `${shortModelName(profileModel.model)} ${EFFORT_LABELS[profileEffort] ?? profileEffort}`
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
                  ? "Default model and reasoning for new threads in every profile, on all your devices. The composer can still change it for one thread."
                  : `New threads use each profile's own model${profile ? ` (${profile.name}: ${profileLabel})` : ""}. Pick one to use everywhere, on all your devices.`}
                {mine && !available && profile && (
                  <span className="mt-1 block text-amber-600 dark:text-amber-400">
                    {profile.name} can't run this model, so its threads use {profileLabel}.
                  </span>
                )}
              </>
            }
          >
            {providers.length ? (
              <ModelPicker
                value={mine ?? (profileModel ? { ...profileModel, effort: profileModel.effort ?? profileEffort } : null)}
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
      <SettingsGroup title="Switching threads">
        <SettingsCard>
          <SettingRow
            label="Ctrl+Tab"
            description={
              ctrlTab === "recent"
                ? "Most recent: goes back to the thread you had open before. Hold Ctrl and keep pressing Tab to go further back; Ctrl+Shift+Tab goes the other way."
                : "List order: opens the next thread down the list. Ctrl+Shift+Tab opens the one above."
            }
          >
            <Select items={CTRL_TAB_MODES} value={ctrlTab} onValueChange={(v) => v && setCtrlTabMode(v as CtrlTabMode)}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CTRL_TAB_MODES.map((m) => (
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
