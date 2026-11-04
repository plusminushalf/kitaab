import { Pressable, ScrollView, Text, View } from "react-native"
import * as Haptics from "expo-haptics"
import type { Id, PendingQuestion } from "@kitab/core/model"
import { backend } from "@kitab/core/backend"
import { toast } from "@kitab/core/platform"
import { mono, useColors } from "@/lib/theme"
import { Icon } from "./ui"

const CHOICE_LABELS: Record<string, string> = {
  once: "Allow once",
  session: "Allow for this thread",
  always: "Always allow",
  deny: "Deny",
}

/** Hermes asking before it runs something, or asking a question. Sits above the composer. */
export function PendingCard({ threadId, question: q }: { threadId: Id; question: PendingQuestion }) {
  const c = useColors()
  const answer = (value: string) => {
    void Haptics.selectionAsync()
    backend.answer(threadId, q, value).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  }
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 8, backgroundColor: c.warningSurface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Icon name={q.kind === "approval" ? "hand.raised.fill" : "questionmark.bubble.fill"} size={16} color={c.warning} />
        <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: "600", lineHeight: 20 }}>{q.title}</Text>
      </View>
      {q.detail ? (
        <ScrollView horizontal style={{ backgroundColor: c.codeBackground, borderRadius: 8 }} contentContainerStyle={{ padding: 10 }}>
          <Text style={{ fontFamily: mono, fontSize: 12, color: c.text }} selectable>
            {q.detail}
          </Text>
        </ScrollView>
      ) : null}
      {q.choices?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {q.choices.map((choice) => {
            const deny = choice === "deny"
            return (
              <Pressable
                key={choice}
                onPress={() => answer(choice)}
                style={({ pressed }) => ({
                  backgroundColor: deny ? c.surface : c.accent,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  opacity: pressed ? 0.7 : 1,
                  borderWidth: deny ? 1 : 0,
                  borderColor: c.border,
                })}
              >
                <Text style={{ color: deny ? c.text : c.accentForeground, fontWeight: "600", fontSize: 14 }}>{CHOICE_LABELS[choice] ?? choice}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : (
        <Text style={{ color: c.textMuted, fontSize: 13 }}>Answer in the message box below.</Text>
      )}
    </View>
  )
}
