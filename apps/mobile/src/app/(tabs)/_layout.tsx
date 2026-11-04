import { NativeTabs } from "expo-router/native-tabs"
import { useColors } from "@/lib/theme"

export default function Tabs() {
  const c = useColors()
  return (
    <NativeTabs tintColor={c.text}>
      <NativeTabs.Trigger name="(threads)">
        <NativeTabs.Trigger.Label>Threads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="routines">
        <NativeTabs.Trigger.Label>Routines</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="personalities">
        <NativeTabs.Trigger.Label>Personalities</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
