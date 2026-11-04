import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// Agent replies are markdown. Stock Tailwind typography, nothing custom.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="selectable prose prose-neutral max-w-none min-w-0 wrap-anywhere dark:prose-invert prose-pre:overflow-x-auto prose-pre:bg-code prose-pre:text-code-foreground prose-pre:wrap-normal prose-th:wrap-normal prose-td:wrap-normal prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
