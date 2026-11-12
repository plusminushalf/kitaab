import { useEffect, useState } from "react"
import { Alert, Pressable, Share, Switch, Text, TextInput, View } from "react-native"
import { router, Stack } from "expo-router"
import * as Clipboard from "expo-clipboard"
import * as Haptics from "expo-haptics"
import Constants from "expo-constants"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { backend, gw } from "@kitab/core/backend"
import { toast } from "@kitab/core/platform"
import { analyticsOn, setAnalyticsOn } from "@kitab/core/analytics"
import Ssh from "../../modules/kitab-ssh/src/KitabSshModule"
import { restartServer } from "@/lib/platform"
import { serverSettings, useServerSettings } from "@/lib/settings"
import { store, useStore } from "@/lib/store"
import { setPrefs, usePrefs, type ThreadsLayout } from "@/lib/prefs"
import { mono, useColors } from "@/lib/theme"
import { Button, HeaderTextButton, Icon, Row, Section } from "@/components/ui"

export default function Settings() {
  const c = useColors()
  const saved = useServerSettings()
  const conn = useStore((s) => s.connection)
  const { layout } = usePrefs()
  const [host, setHost] = useState(saved.host)
  const [user, setUser] = useState(saved.user)
  const [port, setPort] = useState(String(saved.port || 22))
  const [publicKey, setPublicKey] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Ssh.publicKey().then(setPublicKey, (e) => setPublicKey(`Couldn't make this iPhone's key: ${e instanceof Error ? e.message : e}`))
  }, [])

  const changed = host.trim() !== saved.host || user.trim() !== saved.user || Number(port) !== saved.port
  const input = { color: c.text, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12, flex: 1 }

  async function connect() {
    const next = { host: host.trim(), user: user.trim(), port: Number(port) || 22 }
    if (!next.host || !next.user) return toast.warning("Enter the host and your user name")
    // A different host means a different host key.
    const moved = next.host !== saved.host || next.port !== saved.port
    serverSettings.set({ ...next, hostKey: moved ? undefined : saved.hostKey })
    setBusy(true)
    gw.close()
    await Ssh.disconnect()
    store.set({ connection: { state: "idle" } })
    try {
      await backend.connect()
      const state = store.get().connection
      if (state.state === "connected") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.back()
      }
    } finally {
      setBusy(false)
    }
  }

  function copyKey() {
    if (!publicKey) return
    void Clipboard.setStringAsync(publicKey)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    toast.success("Public key copied")
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <HeaderTextButton title="Done" bold onPress={() => router.back()} />,
        }}
      />
      <KeyboardAwareScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: c.surfaceRaised }} contentContainerStyle={{ padding: 16 }} bottomOffset={24}>
        <Section
          title="Hermes host"
          footer="Kitaab signs in over SSH and shares one private Hermes backend with your Mac, so threads, routines and personalities are the same on both. Use the address your phone can reach, like a Tailscale name."
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: c.textMuted, fontSize: 16, width: 64, paddingLeft: 16 }}>Host</Text>
            <TextInput value={host} onChangeText={setHost} placeholder="dev.tailnet.ts.net" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
          </View>
          <View style={{ height: 0.5, backgroundColor: c.border, marginLeft: 16 }} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: c.textMuted, fontSize: 16, width: 64, paddingLeft: 16 }}>User</Text>
            <TextInput value={user} onChangeText={setUser} placeholder="you" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} style={input} />
          </View>
          <View style={{ height: 0.5, backgroundColor: c.border, marginLeft: 16 }} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: c.textMuted, fontSize: 16, width: 64, paddingLeft: 16 }}>Port</Text>
            <TextInput value={port} onChangeText={setPort} keyboardType="number-pad" style={input} />
          </View>
        </Section>

        <Button
          title={conn.state === "connected" && !changed ? `Connected to ${saved.host}` : changed || conn.state !== "connected" ? "Connect" : "Reconnect"}
          onPress={connect}
          loading={busy || conn.state === "connecting"}
          disabled={conn.state === "connected" && !changed}
          style={{ marginBottom: conn.state === "error" ? 8 : 24 }}
        />
        {conn.state === "error" ? <Text style={{ color: c.error, fontSize: 14, marginBottom: 24, marginHorizontal: 4 }}>{conn.message}</Text> : null}

        <Section title="This iPhone's key" footer="Add this line to ~/.ssh/authorized_keys on the host. The private half never leaves this iPhone's Keychain.">
          <Pressable onPress={copyKey} style={{ padding: 16 }}>
            <Text style={{ fontFamily: mono, fontSize: 12, color: c.text, lineHeight: 17 }} selectable>
              {publicKey ?? "…"}
            </Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
            <Button title="Copy" variant="secondary" onPress={copyKey} style={{ flex: 1 }} />
            <Button title="Share" variant="secondary" onPress={() => publicKey && void Share.share({ message: publicKey })} style={{ flex: 1 }} />
          </View>
        </Section>

        {saved.hostKey ? (
          <Section title="Host key" footer="Kitaab trusted this key the first time it connected and refuses a host that shows a different one.">
            <View style={{ padding: 16, gap: 4 }}>
              <Text style={{ fontFamily: mono, fontSize: 12, color: c.text, lineHeight: 17 }} selectable>
                {saved.hostFingerprint ?? saved.hostKey}
              </Text>
              <Text style={{ fontSize: 13, color: c.textMuted }}>{saved.hostKey.split(" ")[0]}</Text>
            </View>
            <View style={{ height: 0.5, backgroundColor: c.border, marginLeft: 16 }} />
            <Row
              title="Forget host key"
              destructive
              last
              onPress={() =>
                Alert.alert("Forget the host key?", "The next connection will trust whatever key the host shows.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Forget", style: "destructive", onPress: () => serverSettings.set({ hostKey: undefined }) },
                ])
              }
            />
          </Section>
        ) : null}

        <Section title="Project layout" footer="How the Threads tab shows a profile's projects. List: one list across projects, each thread saying where it lives. Folders: a folder per project, in its color.">
          {(
            [
              { id: "list", title: "List" },
              { id: "folders", title: "Folders" },
            ] as { id: ThreadsLayout; title: string }[]
          ).map((o, i) => (
            <Row
              key={o.id}
              title={o.title}
              last={i === 1}
              onPress={() => {
                void Haptics.selectionAsync()
                setPrefs({ layout: o.id })
              }}
              right={layout === o.id ? <Icon name="checkmark" size={15} weight="semibold" /> : undefined}
            />
          ))}
        </Section>

        {saved.host ? (
          <Section title="Server" footer="Restarting stops Kitaab's Hermes backend on the host for every device. The next connection starts a fresh one.">
            {conn.state === "connected" ? <Row title="Hermes" detail={conn.version ? `Version ${conn.version}` : undefined} /> : null}
            <Row
              title="Restart Hermes backend"
              destructive
              last
              onPress={() =>
                Alert.alert("Restart the Hermes backend?", "Anything running on it, from any device, stops.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Restart",
                    style: "destructive",
                    onPress: async () => {
                      setBusy(true)
                      try {
                        gw.close()
                        await restartServer()
                        store.set({ connection: { state: "idle" } })
                        await backend.connect()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e))
                      } finally {
                        setBusy(false)
                      }
                    },
                  },
                ])
              }
            />
          </Section>
        ) : null}

        <ToolDetails />

        <ShareUsage />

        <Text style={{ color: c.textMuted, fontSize: 13, textAlign: "center" }}>Kitaab {Constants.expoConfig?.version}</Text>
      </KeyboardAwareScrollView>
    </>
  )
}

/** Whether the work log lists every tool call's parameters (this iPhone only). */
function ToolDetails() {
  const on = useStore((s) => s.showToolDetails)
  return (
    <Section title="Work log" footer="List every parameter each step was called with: which skill it opened, the exact command it ran. Off: one short line per step.">
      <Row title="Tool call details" last right={<Switch value={on} onValueChange={(v) => backend.setShowToolDetails(v)} />} />
    </Section>
  )
}

/** The one switch for usage analytics (lib/analytics.ts). */
function ShareUsage() {
  const [on, setOn] = useState(analyticsOn)
  return (
    <Section
      title="Privacy"
      footer="Sends Kitaab anonymous counts of what gets used, like messages sent and threads marked done, plus crashes. Never your messages, titles, names or hosts."
    >
      <Row
        title="Share usage"
        last
        right={
          <Switch
            value={on}
            onValueChange={(v) => {
              setOn(v)
              setAnalyticsOn(v)
            }}
          />
        }
      />
    </Section>
  )
}
