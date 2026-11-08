import { useEffect, useRef, useState } from "react"
import { Check, Circle, CircleCheck, CircleX, Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SetupProblem, SetupStep, SetupTarget } from "../../../shared/bridge"
import logo from "../../../../resources/icon.svg"

type Kind = SetupTarget["kind"]

/**
 * First run: asks where Hermes is, checks the connection one step at a time, and says
 * plainly what's wrong. Settings are saved only once the check passes.
 */
export function SetupView({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("ssh")
  const [host, setHost] = useState("")
  const [url, setUrl] = useState("http://127.0.0.1:9119")
  const [hosts, setHosts] = useState<string[]>([])
  const [steps, setSteps] = useState<SetupStep[]>([])
  const [running, setRunning] = useState(false)
  const [passed, setPassed] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.hermes.setup.sshHosts().then(setHosts)
  }, [])

  const value = kind === "ssh" ? host.trim() : url.trim()
  const failed = steps.some((s) => s.state === "failed")

  const connect = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!value || running) return
    setRunning(true)
    setPassed(false)
    const target: SetupTarget = kind === "ssh" ? { kind, host: value } : { kind, url: value }
    try {
      const result = await window.hermes.setup.check(target, setSteps)
      setSteps(result.steps)
      if (!result.ok) return
      setPassed(true)
      const current = await window.hermes.settings.get()
      await window.hermes.settings.set(
        kind === "ssh" ? { ...current, sshHost: value } : { sshHost: "", baseUrl: new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`).origin },
      )
      // A moment to see every step pass before the app takes over.
      setTimeout(onDone, 600)
    } catch (err) {
      setSteps((s) => [
        ...s,
        {
          id: "error",
          label: "Check the connection",
          state: "failed",
          problem: { title: "Something went wrong", explain: err instanceof Error ? err.message : String(err) },
        },
      ])
    } finally {
      setRunning(false)
    }
  }

  const switchKind = (k: Kind) => {
    if (running) return
    setKind(k)
    setSteps([])
    requestAnimationFrame(() => input.current?.focus())
  }

  return (
    <div className="app-drag flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className="app-no-drag m-auto w-full max-w-[460px] px-6 py-14">
        <img src={logo} alt="" className="size-14" draggable={false} />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Where is Hermes running?</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Kitaab talks to Hermes Agent on a computer you can reach. Tell it where, and it will check the connection.
        </p>

        <Tabs value={kind} onValueChange={(v) => switchKind(v as Kind)} className="mt-6">
          <TabsList className="w-full">
            <TabsTrigger value="ssh" disabled={running}>
              Over SSH
            </TabsTrigger>
            <TabsTrigger value="url" disabled={running}>
              Dashboard URL
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <form onSubmit={connect} className="mt-4">
          <label htmlFor="setup-target" className="text-sm font-medium">
            {kind === "ssh" ? "SSH host" : "Dashboard address"}
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              ref={input}
              id="setup-target"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={running}
              list={kind === "ssh" ? "setup-ssh-hosts" : undefined}
              placeholder={kind === "ssh" ? "user@server, or an alias from ~/.ssh/config" : "http://127.0.0.1:9119"}
              value={kind === "ssh" ? host : url}
              onChange={(e) => {
                ;(kind === "ssh" ? setHost : setUrl)(e.target.value)
                if (!running) setSteps([])
              }}
              className="flex-1"
            />
            <Button type="submit" disabled={!value || running || passed}>
              {running && <Spinner />}
              {running ? "Checking…" : failed ? "Try again" : "Connect"}
            </Button>
          </div>
          {kind === "ssh" && (
            <datalist id="setup-ssh-hosts">
              {hosts.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {kind === "ssh"
              ? "Kitaab signs in with your SSH key and starts its own private Hermes backend there. Hermes must already be installed on that machine."
              : "A Hermes dashboard you already run, such as one started with hermes dashboard. If it needs a sign-in, Kitaab opens your browser next."}
          </p>
        </form>

        {steps.length > 0 && <StepList steps={steps} />}
      </div>
    </div>
  )
}

function StepList({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="mt-6 flex flex-col gap-2.5" aria-live="polite">
      {steps.map((s) => (
        <li key={s.id}>
          <div className="flex items-center gap-2.5 text-sm">
            <StepIcon state={s.state} />
            <span className={s.state === "pending" ? "text-muted-foreground" : undefined}>{s.label}</span>
            {s.detail && <span className="ml-auto truncate text-xs text-muted-foreground">{s.detail}</span>}
          </div>
          {s.problem && <Problem problem={s.problem} />}
        </li>
      ))}
    </ol>
  )
}

function StepIcon({ state }: { state: SetupStep["state"] }) {
  if (state === "running") return <Spinner className="text-muted-foreground" />
  if (state === "ok") return <CircleCheck className="size-4 text-emerald-500" />
  if (state === "failed") return <CircleX className="size-4 text-destructive" />
  return <Circle className="size-4 text-muted-foreground/50" />
}

function Problem({ problem }: { problem: SetupProblem }) {
  return (
    <div className="mt-2.5 ml-6.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="font-medium">{problem.title}</p>
      <p className="mt-1 text-muted-foreground">{problem.explain}</p>
      {problem.command && <Command text={problem.command} />}
      {problem.link && (
        <a
          href={problem.link.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {problem.link.label}
          <ExternalLink className="size-3" />
        </a>
      )}
      {problem.output && (
        <details className="mt-2 text-xs">
          <summary className="cursor-default text-muted-foreground select-none hover:text-foreground">Details</summary>
          <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap select-text">
            {problem.output}
          </pre>
        </details>
      )}
    </div>
  )
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="mt-2 flex items-start gap-1 rounded-md bg-muted py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 py-1 font-mono text-xs break-all select-text">{text}</code>
      <Button type="button" variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy command">
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
