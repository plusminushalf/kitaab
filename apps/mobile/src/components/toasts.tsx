import { Pressable, Text, View } from "react-native"
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { dismissToast, useToasts } from "@/lib/toast"
import { useColors } from "@/lib/theme"
import { Icon } from "./ui"

/** Notices from the core, as banners at the top of the screen. */
export function Toasts() {
  const toasts = useToasts()
  const insets = useSafeAreaInsets()
  const c = useColors()
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 4, left: 12, right: 12, gap: 8 }}>
      {toasts.map((t) => (
        <Animated.View key={t.id} entering={FadeInUp} exiting={FadeOutUp}>
          <Pressable
            onPress={() => dismissToast(t.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: c.surface,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: c.border,
              shadowColor: "#000",
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <Icon
              name={t.kind === "error" ? "exclamationmark.circle.fill" : t.kind === "warning" ? "exclamationmark.triangle.fill" : t.kind === "success" ? "checkmark.circle.fill" : "info.circle.fill"}
              size={18}
              color={t.kind === "error" ? c.error : t.kind === "warning" ? c.warning : t.kind === "success" ? c.done : c.textMuted}
            />
            <Text style={{ flex: 1, color: c.text, fontSize: 14, lineHeight: 19 }} numberOfLines={4}>
              {t.message}
            </Text>
            {t.action ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  t.action!.onClick()
                  dismissToast(t.id)
                }}
              >
                <Text style={{ color: c.text, fontWeight: "600", fontSize: 14 }}>{t.action.label}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Animated.View>
      ))}
    </View>
  )
}
