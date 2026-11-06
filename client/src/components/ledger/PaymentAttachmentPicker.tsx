import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageAttachmentPreview } from "@/components/entity-files/EntityFileManager";

/** Local selection only. Uploads belong to the successful payment-save lifecycle. */
export function PaymentAttachmentPicker({
  file,
  onChange,
  disabled = false,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2 rounded-md border p-4" data-testid="payment-attachment-picker">
      <div>
        <label htmlFor="payment-attachment-input" className="text-sm font-medium">Payment image (optional)</label>
        <p className="text-xs text-muted-foreground">
          The image stays on this device until the payment saves, then uploads through Entity Files.
          Uploads must meet the configured Payments file rules.
        </p>
      </div>
      <input
        id="payment-attachment-input"
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,image/jpeg,image/png,image/gif,image/webp,image/bmp,image/tiff"
        className="hidden"
        disabled={disabled}
        data-testid="input-payment-attachment"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          if (selected && !disabled) onChange(selected);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={disabled}
          onClick={() => inputRef.current?.click()} data-testid="button-select-payment-attachment">
          <ImagePlus className="mr-2 h-4 w-4" />
          {file ? "Replace image" : "Select image"}
        </Button>
        {file && (
          <>
            <span className="max-w-sm truncate text-sm" data-testid="text-payment-attachment-name">{file.name}</span>
            <Button type="button" size="sm" variant="ghost" disabled={disabled}
              onClick={() => onChange(null)} data-testid="button-remove-payment-attachment">
              <X className="mr-1 h-4 w-4" />Remove
            </Button>
          </>
        )}
      </div>
      {file?.type.toLowerCase().startsWith("image/") && (
        <ImageAttachmentPreview file={file} alt={`Preview of ${file.name}`} testId="payment-attachment-preview" />
      )}
    </div>
  );
}
