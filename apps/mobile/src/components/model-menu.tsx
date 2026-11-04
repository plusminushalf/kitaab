import { MenuView, type MenuAction } from "@expo/ui/community/menu"
import type { Id } from "@kitab/core/model"
import { backend } from "@kitab/core/backend"
import { EFFORT_LABELS, modelName } from "@kitab/core/model-names"
import { useStore, type ModelChoice } from "@/lib/store"

const EFFORTS = ["low", "medium", "high", "xhigh"]

/** The model (and effort) for a thread, or for the next new thread when threadId is null. */
export function useModelChoice(threadId: Id | null): ModelChoice | null {
  return useStore((s) => (threadId ? s.threadModels[threadId] : s.draftModel) ?? s.defaultModel)
}

/** Native menu: providers → models, plus reasoning effort when the model has it. */
export function ModelMenu({ threadId, children }: { threadId: Id | null; children: React.ReactNode }) {
  const providers = useStore((s) => s.models)
  const defaultEffort = useStore((s) => s.defaultEffort)
  const current = useModelChoice(threadId)
  const caps = current ? providers.find((p) => p.slug === current.provider)?.caps[current.model] : undefined

  const actions: MenuAction[] = providers.map((p) => ({
    id: `provider:${p.slug}`,
    title: p.name,
    state: current?.provider === p.slug ? "on" : "off",
    subactions: p.models.map((m) => ({
      id: `model:${p.slug}:${m}`,
      title: modelName(m),
      state: current?.provider === p.slug && current.model === m ? "on" : "off",
    })),
  }))
  if (current && caps?.reasoning !== false) {
    actions.push({
      id: "effort",
      title: `Reasoning: ${EFFORT_LABELS[current.effort ?? defaultEffort] ?? current.effort ?? defaultEffort}`,
      image: "brain",
      subactions: EFFORTS.map((e) => ({ id: `effort:${e}`, title: EFFORT_LABELS[e] ?? e, state: (current.effort ?? defaultEffort) === e ? "on" : "off" })),
    })
  }
  if (current && caps?.fast) {
    actions.push({ id: "fast", title: "Fast mode", image: "hare", state: current.fast ? "on" : "off" })
  }

  return (
    <MenuView
      title="Model"
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const id = nativeEvent.event
        if (id.startsWith("model:")) {
          const [, provider, ...rest] = id.split(":")
          void backend.setModel(threadId, { model: rest.join(":"), provider, effort: current?.effort })
        } else if (id.startsWith("effort:") && current) {
          void backend.setModel(threadId, { ...current, effort: id.slice(7) })
        } else if (id === "fast" && current) {
          void backend.setModel(threadId, { ...current, fast: !current.fast })
        }
      }}
    >
      {children}
    </MenuView>
  )
}
