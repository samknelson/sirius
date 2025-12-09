import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pen, Type, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SignatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docType: string;
  docTitle: string;
  docRender: string;
  entityId: string;
  onSuccess: (result: { esig: any; cardcheck: any }) => void;
}

export function SignatureModal({
  open,
  onOpenChange,
  docType,
  docTitle,
  docRender,
  entityId,
  onSuccess,
}: SignatureModalProps) {
  const [signatureType, setSignatureType] = useState<"canvas" | "typed">("typed");
  const [typedName, setTypedName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const { toast } = useToast();

  const signMutation = useMutation({
    mutationFn: async (signatureData: { signatureType: string; esigData: any; docRender: string }) => {
      return apiRequest("POST", `/api/cardcheck/${entityId}/sign`, signatureData);
    },
    onSuccess: (result) => {
      toast({
        title: "Document Signed",
        description: "Your signature has been recorded successfully.",
      });
      onOpenChange(false);
      onSuccess(result);
    },
    onError: (error: any) => {
      toast({
        title: "Signing Failed",
        description: error.message || "Failed to sign the document.",
        variant: "destructive",
      });
    },
  });

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, []);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    }
  }, []);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
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

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    lastPosRef.current = getCanvasPos(e);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;

    const currentPos = getCanvasPos(e);
    
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();
    
    lastPosRef.current = currentPos;
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const handleSign = () => {
    let esigData: any;
    
    if (signatureType === "typed") {
      if (!typedName.trim()) {
        toast({
          title: "Name Required",
          description: "Please type your name to sign.",
          variant: "destructive",
        });
        return;
      }
      esigData = {
        type: "typed",
        value: typedName.trim(),
        signedAt: new Date().toISOString(),
      };
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const dataUrl = canvas.toDataURL("image/png");
      esigData = {
        type: "canvas",
        value: dataUrl,
        signedAt: new Date().toISOString(),
      };
    }

    signMutation.mutate({
      signatureType,
      esigData,
      docRender,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title-sign">Sign Document</DialogTitle>
          <DialogDescription>
            Review the document below and provide your signature.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 min-h-0 space-y-4">
          <div className="border rounded-md p-4 bg-muted/30">
            <h3 className="font-semibold text-lg mb-2">{docTitle}</h3>
            <ScrollArea className="h-48">
              <div 
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: docRender }}
                data-testid="text-document-content"
              />
            </ScrollArea>
          </div>

          <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as "canvas" | "typed")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="typed" data-testid="tab-typed">
                <Type className="h-4 w-4 mr-2" />
                Type Name
              </TabsTrigger>
              <TabsTrigger value="canvas" data-testid="tab-canvas">
                <Pen className="h-4 w-4 mr-2" />
                Draw Signature
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="typed" className="mt-4">
              <div className="space-y-2">
                <Label htmlFor="typed-name">Full Legal Name</Label>
                <Input
                  id="typed-name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type your full name"
                  className="text-lg"
                  data-testid="input-typed-name"
                />
                {typedName && (
                  <div className="mt-4 p-4 border rounded-md bg-white dark:bg-gray-900">
                    <p className="text-center font-signature text-2xl italic">{typedName}</p>
                  </div>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="canvas" className="mt-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Draw your signature below</Label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearCanvas}
                    data-testid="button-clear-canvas"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                </div>
                <div className="border rounded-md bg-white overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={150}
                    className="w-full h-36 cursor-crosshair touch-none"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    data-testid="canvas-signature"
                    onLoad={initCanvas}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={signMutation.isPending}
            data-testid="button-cancel-sign"
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSign}
            disabled={signMutation.isPending || (signatureType === "typed" && !typedName.trim())}
            data-testid="button-confirm-sign"
          >
            {signMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Signing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Sign Document
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
