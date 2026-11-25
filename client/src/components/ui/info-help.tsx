import { useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Compact help affordance for explanatory plain text.
 *
 * Pass `text` (null, omitted, or whitespace-only text renders nothing), an
 * optional contextual `title`, `className` for the trigger, and
 * `contentClassName` for the text. `data-testid` targets the trigger;
 * `tooltipTestId` and `dialogTestId` optionally target the respective content.
 *
 * @example
 * <InfoHelp text="When this server process started." title="Server uptime" />
 */
export interface InfoHelpProps {
  text?: string | null;
  title?: string | null;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
  tooltipTestId?: string;
  dialogTestId?: string;
}

export function InfoHelp({
  text,
  title,
  className,
  contentClassName,
  "data-testid": testId,
  tooltipTestId,
  dialogTestId,
}: InfoHelpProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressTooltip = useRef(false);
  const content = text?.trim() ? text : null;

  if (!content) return null;

  const contextualTitle = title?.trim();
  const dialogTitle = contextualTitle || "More information";
  const accessibleLabel = contextualTitle
    ? `More information about ${contextualTitle}`
    : "More information";

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (open) {
      suppressTooltip.current = true;
      setTooltipOpen(false);
      return;
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <Tooltip
        open={!dialogOpen && !suppressTooltip.current && tooltipOpen}
        onOpenChange={(open) => {
          if (!dialogOpen && !suppressTooltip.current) setTooltipOpen(open);
        }}
      >
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("h-10 w-10 shrink-0 text-muted-foreground", className)}
              aria-label={accessibleLabel}
              data-testid={testId}
            >
              <CircleHelp aria-hidden="true" className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        {!dialogOpen && <TooltipContent
          data-testid={tooltipTestId}
          side="top"
          className="max-h-[min(24rem,calc(100dvh-2rem))] max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        >
          {content}
        </TooltipContent>}
      </Tooltip>
      <DialogContent
        className="max-h-[min(80vh,calc(100dvh-2rem))] w-[calc(100vw-2rem)] overflow-hidden p-5 sm:p-6"
        onCloseAutoFocus={() => {
          // Radix restores trigger focus synchronously after this handler.
          // Ignore that focus event, then allow the next intentional preview.
          queueMicrotask(() => { suppressTooltip.current = false; });
        }}
      >
        <DialogHeader className="min-w-0 break-words pr-8 [overflow-wrap:anywhere]">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <DialogDescription
          data-testid={dialogTestId}
          className={cn(
            "max-h-[min(60vh,calc(100dvh-10rem))] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]",
            contentClassName,
          )}
        >
          {content}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
