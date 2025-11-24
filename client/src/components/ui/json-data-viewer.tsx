import { useState } from "react";
import { FileJson, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface JsonDataViewerProps {
  data: unknown;
  title?: string;
  description?: string;
  buttonText?: string;
  buttonVariant?: "default" | "outline" | "ghost" | "link";
  iconOnly?: boolean;
}

export function JsonDataViewer({
  data,
  title = "JSON Data",
  description = "View the raw JSON data",
  buttonText = "View Data",
  buttonVariant = "ghost",
  iconOnly = false,
}: JsonDataViewerProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  if (!data) {
    return null;
  }

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      toast({
        title: "Copied",
        description: "JSON data copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {iconOnly ? (
          <Button
            variant={buttonVariant}
            size="sm"
            className="h-8 w-8 p-0"
            title={buttonText}
            data-testid="button-view-json"
          >
            <FileJson className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant={buttonVariant}
            size="sm"
            data-testid="button-view-json"
          >
            <FileJson className="h-4 w-4 mr-2" />
            {buttonText}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex justify-end mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              data-testid="button-copy-json"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <div className="flex-1 overflow-auto bg-muted rounded-md p-4">
            <pre className="text-sm" data-testid="json-content">
              <code>{jsonString}</code>
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
