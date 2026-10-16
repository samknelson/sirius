import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Loader2, RefreshCw } from "lucide-react";

export interface ExistingBulkMessageOption {
  id: string;
  name: string;
  status: string;
  medium: string[];
  data: { offline?: boolean };
}

export interface ExistingMessageChooserContentProps {
  messages: ExistingBulkMessageOption[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  selectedContactCount: number;
  selectedBulkMessageId: string | null;
  isPending: boolean;
  testIdPrefix: string;
  onSelect: (bulkMessageId: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ExistingMessageChooserContent({
  messages,
  isLoading,
  isError,
  isFetching,
  selectedContactCount,
  selectedBulkMessageId,
  isPending,
  testIdPrefix,
  onSelect,
  onRetry,
  onCancel,
  onSubmit,
}: ExistingMessageChooserContentProps) {
  const hasSelection = selectedContactCount > 0;
  const canSubmit = hasSelection && !isLoading && !isError && !isPending &&
    messages.some(message => message.id === selectedBulkMessageId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add recipients to an existing draft</DialogTitle>
        <DialogDescription>
          Choose a message for {selectedContactCount.toLocaleString()} selected recipient{selectedContactCount === 1 ? "" : "s"}.
          Only recipients are added; content and delivery settings stay unchanged.
          Only drafts with no delivery started are eligible. This action never sends a message.
        </DialogDescription>
      </DialogHeader>
      {isLoading ? (
        <div className="space-y-3 py-2" role="status" aria-label="Loading bulk messages">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-[72px] animate-pulse rounded-md border bg-muted/60" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Messages couldn’t be loaded. Try again.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-dashed px-5 py-8 text-center">
          <p className="font-medium">No existing messages</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a draft first, then add recipients here.</p>
        </div>
      ) : (
        <ScrollArea className="h-[min(52vh,420px)] pr-3">
          <div className="space-y-2">
            {messages.map((message) => {
              const isChosen = selectedBulkMessageId === message.id;
              const channels = message.medium?.length ? message.medium.join(", ") : "No channels";
              return (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => onSelect(message.id)}
                  aria-pressed={isChosen}
                  className={`flex w-full items-start justify-between gap-4 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isChosen ? "border-primary bg-primary/5" : "hover:bg-muted/60"
                  }`}
                  data-testid={`${testIdPrefix}-existing-option-${message.id}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{message.name}</span>
                    <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span className="capitalize">{message.status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{channels}</span>
                      {message.data?.offline && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Offline</span>
                        </>
                      )}
                    </span>
                  </span>
                  {isChosen && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Selected" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
      <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          data-testid={`${testIdPrefix}-existing-submit`}
        >
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Add recipients
        </Button>
      </DialogFooter>
    </>
  );
}
