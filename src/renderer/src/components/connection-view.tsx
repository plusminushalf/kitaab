import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { PageHeader } from "@/components/page-header"
import { backend } from "@kitab/core/backend"
import { useStore } from "@/lib/store"
import logo from "../../../../resources/icon.svg"

/** Shown instead of content when the server needs a sign-in. */
export function ConnectionView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const connection = useStore((s) => s.connection)
  const [waiting, setWaiting] = useState(false)

  const signIn = async () => {
    setWaiting(true)
    try {
      await window.hermes.auth.signIn()
      await backend.connect()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setWaiting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader />
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia>
            <img src={logo} alt="" className="size-16" draggable={false} />
          </EmptyMedia>
          <EmptyTitle>Sign in to your Hermes server</EmptyTitle>
          <EmptyDescription>
            {waiting
              ? "Finish signing in in your browser."
              : connection.state === "error"
                ? connection.message
                : "Kitaab needs you to sign in before it can reach Hermes."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button onClick={signIn} disabled={waiting}>
            {waiting && <Spinner />}
            Sign in with browser
          </Button>
          <Button variant="outline" onClick={onOpenSettings}>
            Server settings
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
