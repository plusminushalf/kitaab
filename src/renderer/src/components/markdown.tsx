import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { isKitabLink, openKitabLink } from "@kitab/core/links"

// Agent replies are markdown. Stock Tailwind typography, nothing custom.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="selectable prose prose-neutral max-w-none min-w-0 wrap-anywhere dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-code prose-pre:text-code-foreground prose-pre:wrap-normal prose-th:wrap-normal prose-td:wrap-normal prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Keeps kitab:// links (react-markdown drops unknown schemes by default).
        urlTransform={(url) => (isKitabLink(url) ? url : defaultUrlTransform(url))}
        components={{
          // kitab:// links open inside the app; the rest go to the browser (main process).
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
