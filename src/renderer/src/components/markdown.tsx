import { useState } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ImageOff } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { isKitabLink, openKitabLink } from "@kitab/core/links"
import { serverImageUrl, serverPath } from "@kitab/core/server-files"

// Agent replies are markdown. Stock Tailwind typography, nothing custom.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="selectable prose prose-neutral max-w-none min-w-0 wrap-anywhere dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-code prose-pre:text-code-foreground prose-pre:wrap-normal prose-th:wrap-normal prose-td:wrap-normal prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Keeps kitaab:// links (react-markdown drops unknown schemes by default), and loads
        // images given as server paths (![card](/home/me/out/card.png)) from the server.
        urlTransform={(url, key) => {
          if (isKitabLink(url)) return url
          if (key === "src") return serverImageUrl(url) ?? defaultUrlTransform(url)
          return defaultUrlTransform(url)
        }}
        components={{
          // kitaab:// links open inside the app; the rest go to the browser (main process).
          a: ({ href, node: _node, ...props }) =>
            isKitabLink(href) ? (
              <a
                {...props}
                href={href}
                onClick={(e) => {
                  e.preventDefault()
                  void openKitabLink(href)
                }}
              />
            ) : (
              <a {...props} href={href} />
            ),
          img: ({ src, alt, node }) => (
            <ReplyImage src={typeof src === "string" ? src : undefined} alt={alt} written={node?.properties?.src} />
          ),
          // Wide tables scroll inside themselves instead of widening the page.
          table: (props) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** An image in a reply. Click to see it full size; if it can't load, say where it was. */
function ReplyImage({ src, alt, written }: { src?: string; alt?: string; written?: unknown }) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const label = alt || (typeof written === "string" ? (serverPath(written) ?? written).split("/").pop() : "") || "Image"
  if (!src || failed) {
    return (
      <span className="not-prose inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-sm text-muted-foreground">
        <ImageOff className="size-4 shrink-0" />
        <span className="truncate" title={typeof written === "string" ? written : undefined}>
          {label}
        </span>
      </span>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={label} className="not-prose my-3 block max-w-full cursor-zoom-in">
        <img
          src={src}
          alt={alt ?? ""}
          onError={() => setFailed(true)}
          className="max-h-[32rem] max-w-full rounded-lg border object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="truncate">{label}</DialogTitle>
          <img src={src} alt={alt ?? ""} className="max-h-[80vh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
