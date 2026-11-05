import { useState, useRef, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { useNextSubmission } from "../NextSubmission";
import { PenLine, CheckCircle2 } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

type Mode = "typed" | "drawn" | "upload";

/**
 * Step 5: capture the worker's signature — typed name, drawn on canvas,
 * or an uploaded signature image/document. Posting is gated on this.
 */
export function SignatureStep({ wizardId, step, data }: WizardStepComponentProps) {
  const signature = data?.signature as
    | { type: string; value?: string; fileName?: string; signedAt: string }
    | undefined;

  const [mode, setMode] = useState<Mode>("typed");
  const [typedName, setTypedName] = useState("");
  const [replacement, setReplacement] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [hasDrawn, setHasDrawn] = useState(false);
  const draftValid = mode === "typed" ? !!typedName.trim()
    : mode === "drawn" ? hasDrawn : !!file;
  const ready = replacement ? draftValid : !!signature || draftValid;
  const busy = useNextSubmission({
    ready,
    guidance: "Type a full name, draw a signature, or choose a signature file. Next saves it before continuing.",
    submit: async () => {
      if (!ready) throw new Error("Complete the replacement signature before continuing.");
      if (!replacement && signature) return;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a signature file.");
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/wizards/${wizardId}/dispatch/${step.id}/upload`,
          { method: "POST", body, credentials: "include" });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error.message || "Upload failed. Choose a supported file and try again.");
        }
        return;
      }
      const value = mode === "typed" ? typedName.trim() : canvasRef.current?.toDataURL("image/png");
      if (!value) throw new Error("Draw a signature before continuing.");
      await apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { signature: { type: mode, value } } });
    },
  });

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
  }, []);

  useEffect(() => {
    if (mode === "drawn") {
      initCanvas();
      setHasDrawn(false);
    }
  }, [mode, initCanvas]);

  const getPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (busy || !isDrawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
    setHasDrawn(true);
    setReplacement(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <PenLine className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Signature</CardTitle>
            <CardDescription>
              Capture the worker's signature. The election cannot be posted
              without it.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {signature && !replacement && (
          <Alert data-testid="alert-signature-captured">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Signature captured ({signature.type}
              {signature.fileName ? `: ${signature.fileName}` : ""}) at{" "}
              {new Date(signature.signedAt).toLocaleString()}. Capturing a new
              one replaces it.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {(["typed", "drawn", "upload"] as Mode[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? "default" : "outline"}
              size="sm"
              disabled={busy}
              onClick={() => {
                if (mode !== m) {
                  setMode(m);
                  setReplacement(true);
                  setTypedName("");
                  setFile(null);
                  setHasDrawn(false);
                }
              }}
              data-testid={`button-signature-mode-${m}`}
            >
              {m === "typed" ? "Type" : m === "drawn" ? "Draw" : "Upload"}
            </Button>
          ))}
        </div>

        {mode === "typed" && (
          <div className="space-y-3 max-w-lg">
            <div>
              <Label htmlFor="typed-signature">Full name</Label>
              <Input
                id="typed-signature"
                value={typedName}
                disabled={busy}
                onChange={(e) => { setTypedName(e.target.value); setReplacement(true); }}
                placeholder="Type the worker's full name…"
                className="font-serif italic text-lg"
                data-testid="input-typed-signature"
              />
            </div>
          </div>
        )}

        {mode === "drawn" && (
          <div className="space-y-3">
            <canvas
              ref={canvasRef}
              width={500}
              height={160}
              className="border rounded-md w-full max-w-lg touch-none bg-white"
              onMouseDown={(e) => {
                if (busy) return;
                setReplacement(true);
                isDrawingRef.current = true;
                lastPosRef.current = getPos(e);
              }}
              onMouseMove={draw}
              onMouseUp={() => (isDrawingRef.current = false)}
              onMouseLeave={() => (isDrawingRef.current = false)}
              onTouchStart={(e) => {
                if (busy) return;
                setReplacement(true);
                isDrawingRef.current = true;
                lastPosRef.current = getPos(e);
              }}
              onTouchMove={draw}
              onTouchEnd={() => (isDrawingRef.current = false)}
              data-testid="canvas-signature"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  initCanvas();
                  setHasDrawn(false);
                  setReplacement(true);
                }}
                data-testid="button-clear-signature"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {mode === "upload" && (
          <div className="space-y-3 max-w-lg">
            <div>
              <Label htmlFor="signature-file">Signature file</Label>
              <Input
                id="signature-file"
                type="file"
                disabled={busy}
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setReplacement(true);
                }}
                data-testid="input-signature-file"
              />
            </div>
            {file && <p className="text-sm text-muted-foreground">{file.name} — ready to upload with Next.</p>}
            {busy && <p className="text-sm text-muted-foreground">Uploading or continuing…</p>}
          </div>
        )}
        <p className="text-sm text-muted-foreground">Next saves your signature before continuing. It does not post the election.</p>
      </CardContent>
    </Card>
  );
}
