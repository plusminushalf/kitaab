import { useState } from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
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
  if (q.kind === "secret") return <SecretCard threadId={threadId} question={q} />
  return <QuestionCard threadId={threadId} question={q} />
}

function QuestionCard({ threadId, question: q }: { threadId: Id; question: PendingQuestion }) {
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

/**
 * Hermes asks for a secret or a sudo password. The value lives only in this field: it goes
 * straight to the server, which puts it where it belongs, and never reaches the thread or the model.
 */
function SecretCard({ threadId, question: q }: { threadId: Id; question: PendingQuestion }) {
  const c = useColors()
  const [value, setValue] = useState("")
  const [sent, setSent] = useState(false)
  const submit = (v: string) => {
    if (sent) return
    setSent(true)
    setValue("")
    void Haptics.selectionAsync()
    backend.answer(threadId, q, v).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  }
  const ready = !sent && value.trim().length > 0
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 8, backgroundColor: c.warningSurface, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Icon name="key.fill" size={16} color={c.warning} />
        <Text style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: "600", lineHeight: 20 }}>{q.title}</Text>
      </View>
      {q.detail ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 19 }}>{q.detail}</Text> : null}
      {q.command ? (
        <ScrollView horizontal style={{ backgroundColor: c.codeBackground, borderRadius: 8 }} contentContainerStyle={{ padding: 10 }}>
          <Text style={{ fontFamily: mono, fontSize: 12, color: c.text }} selectable>
            {q.command}
          </Text>
        </ScrollView>
      ) : null}
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={() => ready && submit(value)}
        placeholder="Paste or type it here"
        placeholderTextColor={c.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        editable={!sent}
        returnKeyType="done"
        accessibilityLabel={q.title}
        style={{ backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text }}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => ready && submit(value)}
          disabled={!ready}
          style={({ pressed }) => ({ backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, opacity: !ready ? 0.4 : pressed ? 0.7 : 1 })}
        >
          <Text style={{ color: c.accentForeground, fontWeight: "600", fontSize: 14 }}>Save</Text>
        </Pressable>
        <Pressable
          onPress={() => submit("")}
          disabled={sent}
          style={({ pressed }) => ({ backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: c.border, opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={{ color: c.text, fontWeight: "600", fontSize: 14 }}>Skip</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
        <Icon name="lock.fill" size={11} color={c.textMuted} />
        <Text style={{ flex: 1, color: c.textMuted, fontSize: 12, lineHeight: 16 }}>
          {q.destination ? `${q.destination}. ` : ""}The agent never sees it, and it isn't kept in this thread.
        </Text>
      </View>
    </View>
  )
}
