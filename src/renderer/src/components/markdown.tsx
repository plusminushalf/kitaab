import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ZoomableImage } from "@/components/zoomable-image"
import { citable } from "@/components/cite-selection"
import { isKitabLink, openKitabLink } from "@kitab/core/links"
import { serverImageUrl, serverPath } from "@kitab/core/server-files"
import { highlight } from "@/lib/highlight"
import { cn } from "@/lib/utils"

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
          pre: ({ node }) => {
            const code = node?.children.find((c) => c.type === "element" && c.tagName === "code")
            return <CodeBlock code={hastText(code).replace(/\n$/, "")} lang={fenceLang(code)} className="not-prose my-5" />
          },
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

type HastNode = { type: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }

/** The text inside a markdown (hast) node. */
function hastText(node?: HastNode): string {
  if (!node) return ""
  if (node.type === "text") return node.value ?? ""
  return node.children?.map(hastText).join("") ?? ""
}

/** The language a fence was tagged with (```ts → "ts"), from its code element's class. */
function fenceLang(node?: HastNode): string | undefined {
  const cls = node?.properties?.className
  const list = Array.isArray(cls) ? cls : typeof cls === "string" ? cls.split(" ") : []
  const tag = list.find((c): c is string => typeof c === "string" && c.startsWith("language-"))
  return tag?.slice("language-".length).toLowerCase()
}

/** A fenced code block, syntax-highlighted, with a button in its corner that copies the code. */
export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const html = useMemo(() => highlight(code, lang), [code, lang])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => setCopied(true))
  }
  const label = copied ? "Copied" : "Copy"
  return (
    <div className={cn("code-block group/code relative min-w-0", className)}>
      <pre>
        {html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              onClick={copy}
              className="absolute top-2 right-2 bg-code text-muted-foreground opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100 data-[copied=true]:opacity-100"
              data-copied={copied}
            />
          }
        >
          {copied ? <Check /> : <Copy />}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
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
          {...citable(label, typeof written === "string" ? serverPath(written) : undefined, src)}
          onError={() => setFailed(true)}
          className="max-h-[32rem] max-w-full rounded-lg border object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
          <DialogTitle className="truncate">{label}</DialogTitle>
          <ZoomableImage src={src} alt={alt ?? ""} className="max-h-[80vh]" />
        </DialogContent>
      </Dialog>
    </>
  )
}
