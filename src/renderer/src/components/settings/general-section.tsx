import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { backend } from "@/lib/backend"
import { useStore } from "@/lib/store"
import type { Settings } from "../../../../shared/bridge"
import { SettingRow, SettingsCard, SettingsGroup } from "./settings-page"

/** Where Kitab connects. Over SSH it starts (and reuses) its own private Hermes backend. */
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
            description="A host or an alias from ~/.ssh/config. Kitab starts its own private Hermes backend there and reuses it on every launch. Your SSH key must be in the agent."
          >
            <Input className="w-56" placeholder="dev" {...field("sshHost")} />
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
    </>
  )
}
