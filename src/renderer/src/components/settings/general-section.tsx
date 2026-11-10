import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { analyticsOn, setAnalyticsOn } from "@kitab/core/analytics"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import { canCheck, checkForUpdatesLoudly, describeUpdate, runUpdateAction, updateAction, useUpdateState } from "@/lib/updates"
import { relativeTime } from "@kitab/core/format"
import type { Settings } from "../../../../shared/bridge"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"

/** Where Kitaab connects. Over SSH it starts (and reuses) its own private Hermes backend. */
export function GeneralSection() {
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<Settings | null>(null)
  const connection = useStore((st) => st.connection)

  useEffect(() => {
    void window.hermes.settings.get().then((v) => {
      setS(v)
      setSaved(v)
    })
  }, [])

  const dirty = !!s && !!saved && (s.sshHost !== saved.sshHost || s.baseUrl !== saved.baseUrl)

  const save = async () => {
    if (!s) return
    const next = await window.hermes.settings.set(s)
    setSaved(next)
    void backend.connect()
    toast.success("Saved. Reconnecting…")
  }

  const field = (key: keyof Settings) => ({
    value: s ? String(s[key]) : "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => s && setS({ ...s, [key]: e.target.value }),
  })

  return (
    <>
      <SettingsGroup title="Connection">
        <SettingsCard>
          <SettingRow
            label="Status"
            description={
              connection.state === "connected"
                ? `Connected to ${connection.server}${connection.version ? ` · Hermes ${connection.version}` : ""}`
                : connection.state === "error"
                  ? connection.message
                  : "Connecting…"
            }
          >
            <span
              className={
                "size-2 rounded-full " +
                (connection.state === "connected"
                  ? "bg-emerald-500"
                  : connection.state === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground")
              }
            />
          </SettingRow>
          <SettingRow
            label="SSH host"
            description="A host or an alias from ~/.ssh/config. Kitaab starts its own private Hermes backend there and reuses it on every launch. Your SSH key must be in the agent."
          >
            <Input className="w-56" placeholder="user@server" {...field("sshHost")} />
          </SettingRow>
          <SettingRow
            label="Dashboard URL"
            description="Used only when the SSH host is empty. Asks you to sign in if the dashboard needs it."
          >
            <Input className="w-56" placeholder="http://127.0.0.1:9119" {...field("baseUrl")} />
          </SettingRow>
        </SettingsCard>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => void window.hermes.server.restart().then(() => backend.connect())}
          >
            Restart backend
          </Button>
          <Button disabled={!dirty} onClick={save}>
            Save and connect
          </Button>
        </div>
      </SettingsGroup>
      <UpdatesGroup />
      <PrivacyGroup />
    </>
  )
}

/** The running version, what the updater last found, and the one button that moves it along. */
function UpdatesGroup() {
  const u = useUpdateState()
  if (!u) return null
  const action = updateAction(u)
  const checked = u.checkedAt && u.status !== "checking" ? ` Checked ${relativeTime(u.checkedAt)}.` : ""
  return (
    <SettingsGroup title="Updates">
      <SettingsCard>
        <SettingRow label={`Kitaab ${u.currentVersion}`} description={describeUpdate(u) + checked}>
          {action === "download" && <Button onClick={() => runUpdateAction(u)}>Download {u.availableVersion}</Button>}
          {action === "install" && <Button onClick={() => runUpdateAction(u)}>Restart to update</Button>}
          {u.status === "downloading" && (
            <Button disabled>Downloading {Math.floor(u.downloadPercent ?? 0)}%</Button>
          )}
          {action === "none" && u.status !== "downloading" && (
            <Button variant="outline" disabled={!canCheck(u)} onClick={() => void checkForUpdatesLoudly()}>
              {u.status === "checking" ? "Checking…" : "Check for updates"}
            </Button>
          )}
        </SettingRow>
      </SettingsCard>
    </SettingsGroup>
  )
}

/** The one switch for usage analytics (lib/analytics.ts). */
function PrivacyGroup() {
  const [on, setOn] = useState(analyticsOn)
  return (
    <SettingsGroup title="Privacy">
      <SettingsCard>
        <SettingRow
          label="Share usage"
          description="Sends Kitaab anonymous counts of what gets used, like messages sent and threads marked done, plus crashes. Never your messages, titles, names or hosts."
        >
          <Switch
            checked={on}
            onCheckedChange={(v) => {
              setOn(v)
              setAnalyticsOn(v)
            }}
          />
        </SettingRow>
      </SettingsCard>
    </SettingsGroup>
  )
}
