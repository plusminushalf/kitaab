import { useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { Image } from "expo-image"
import * as ImagePicker from "expo-image-picker"
import * as Haptics from "expo-haptics"
import type { Attachment, Id, Personality } from "@kitab/core/model"
import { shortModelName } from "@kitab/core/model-names"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"
import { ModelMenu, useModelChoice } from "./model-menu"

/**
 * The message box: text, photos, @mentions for the project's personalities, the model, and
 * send/stop. `onSend` resolves once the message is on its way; the box clears right away.
 */
export function Composer({
  threadId,
  working,
  cast,
  placeholder = "Message",
  onSend,
  onStop,
}: {
  threadId: Id | null
  working: boolean
  cast: Personality[]
  placeholder?: string
  onSend: (text: string, attachments: Attachment[]) => Promise<unknown>
  onStop?: () => void
}) {
  const c = useColors()
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const model = useModelChoice(threadId)

  const mention = text.match(/(^|\s)@([a-z0-9-]*)$/i)
  const suggestions = mention ? cast.filter((p) => p.id.startsWith(mention[2].toLowerCase()) || p.name.toLowerCase().startsWith(mention[2].toLowerCase())) : []

  const canSend = (text.trim() || attachments.length) && !sending

  async function send() {
    if (!canSend) return
    const body = text.trim()
    const files = attachments
    setText("")
    setAttachments([])
    setSending(true)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await onSend(body, files)
    } catch {
      // Put it back so nothing is lost.
      setText(body)
      setAttachments(files)
    } finally {
      setSending(false)
    }
  }

  async function pick() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.85, allowsMultipleSelection: true, selectionLimit: 6 })
    if (r.canceled) return
    setAttachments((a) => [
      ...a,
      ...r.assets
        .filter((x) => x.base64)
        .map((x): Attachment => ({
          kind: "image",
          name: x.fileName ?? `photo-${Date.now()}.jpg`,
          url: `data:${x.mimeType ?? "image/jpeg"};base64,${x.base64}`,
          size: x.fileSize,
        })),
    ])
  }

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}>
      {suggestions.length ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {suggestions.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setText((t) => t.replace(/@([a-z0-9-]*)$/i, `@${p.id} `))}
              style={{ backgroundColor: c.secondary, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: c.text, fontSize: 14 }}>
                @{p.id} <Text style={{ color: c.textMuted }}>{p.name}</Text>
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ backgroundColor: c.surface, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingTop: 4, paddingBottom: 6 }}>
        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 10, paddingTop: 6 }}>
            {attachments.map((a, i) => (
              <View key={i}>
                <Image source={{ uri: a.url }} style={{ width: 56, height: 56, borderRadius: 10 }} />
                <Pressable
                  hitSlop={8}
                  onPress={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                  style={{ position: "absolute", top: -6, right: -6, backgroundColor: c.accent, borderRadius: 10, padding: 3 }}
                >
                  <Icon name="xmark" size={9} color={c.accentForeground} weight="bold" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          multiline
          style={{ color: c.text, fontSize: 16, lineHeight: 21, maxHeight: 160, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 4 }}>
          <Pressable onPress={pick} hitSlop={6} style={{ padding: 6 }} accessibilityLabel="Add photos">
            <Icon name="plus" size={18} color={c.textMuted} weight="medium" />
          </Pressable>
          <ModelMenu threadId={threadId}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
              <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
                {model ? shortModelName(model.model) : "Model"}
              </Text>
              <Icon name="chevron.up.chevron.down" size={10} color={c.textMuted} />
            </View>
          </ModelMenu>
          <View style={{ flex: 1 }} />
          {working && !canSend && onStop ? (
            <Pressable onPress={onStop} accessibilityLabel="Stop" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: c.accentForeground }} />
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              disabled={!canSend}
              accessibilityLabel="Send"
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: canSend ? c.accent : c.secondary, alignItems: "center", justifyContent: "center" }}
            >
              {sending ? <ActivityIndicator size="small" color={c.accentForeground} /> : <Icon name="arrow.up" size={15} color={canSend ? c.accentForeground : c.textMuted} weight="bold" />}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}
