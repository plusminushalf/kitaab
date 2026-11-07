import { ModelPicker } from "@/components/model-picker"
import { backend } from "@kitab/core/backend"
import { EFFORT_LABELS, shortModelName } from "@kitab/core/model-names"
import { useStore } from "@/lib/store"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"

/** Defaults for new threads (T3 Code's Settings → Threads). */
export function ThreadsSection() {
  const mine = useStore((s) => s.myModel)
  const projectModel = useStore((s) => s.projectModel)
  const projectEffort = useStore((s) => s.projectEffort)
  const providers = useStore((s) => s.models)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectId))

  const available = mine ? providers.find((p) => p.slug === mine.provider)?.models.includes(mine.model) : true
  const projectLabel = projectModel
    ? `${shortModelName(projectModel.model)} ${EFFORT_LABELS[projectEffort] ?? projectEffort}`
    : "its own model"

  return (
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
  )
}
