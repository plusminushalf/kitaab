import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import { cn } from "cn"

function HoverCard(props: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ delay = 500, closeDelay = 100, ...props }: PreviewCardPrimitive.Trigger.Props) {
  return <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" delay={delay} closeDelay={closeDelay} {...props} />
}

/** A frosted card beside its trigger, like T3 Code's thread previews. */
function HoverCardContent({
  className,
  side = "right",
  align = "start",
  sideOffset = 8,
  alignOffset = 0,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<PreviewCardPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset">) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          // Shares the popover slot so it gets the same glass (blur and solid floor).
          data-slot="popover-content"
          className={cn(
            "z-50 w-80 origin-(--transform-origin) rounded-lg border border-foreground/10 bg-popover p-3 text-sm text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-hidden duration-100 dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
