import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";

interface DebugRecordViewerProps {
  record: unknown;
  entityLabel: string;
}

export function DebugRecordViewer({ record, entityLabel }: DebugRecordViewerProps) {
  const [open, setOpen] = useState(false);
  const { hasPermission, hasComponent } = useAuth();

  const canViewDebug = hasComponent("debug") && hasPermission("debug");

  if (!canViewDebug) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-debug-view-json"
      >
        <Bug className="h-4 w-4 mr-1" />
        Debug: View JSON
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-5 w-5" />
              {entityLabel} Record JSON
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[60vh] w-full rounded-md border p-4">
            <pre className="text-sm font-mono whitespace-pre-wrap break-words">
              {JSON.stringify(record, null, 2)}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
