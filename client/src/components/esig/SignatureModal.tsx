import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pen, Type, Check, X, Upload, FileText, Trash2 } from "lucide-react";
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
  const [signatureType, setSignatureType] = useState<"canvas" | "typed" | "upload">("typed");
  const [typedName, setTypedName] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ fileId: string; fileName: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/esigs/upload-document", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload document");
      }
      
      return response.json();
    },
    onSuccess: (result) => {
      setUploadedFile({
        fileId: result.fileId,
        fileName: result.fileName,
      });
      toast({
        title: "Document Uploaded",
        description: "Document uploaded successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload document.",
        variant: "destructive",
      });
    },
  });

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
    let finalDocRender = docRender;
    
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
    } else if (signatureType === "canvas") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const dataUrl = canvas.toDataURL("image/png");
      esigData = {
        type: "canvas",
        value: dataUrl,
        signedAt: new Date().toISOString(),
      };
    } else if (signatureType === "upload") {
      if (!uploadedFile) {
        toast({
          title: "Document Required",
          description: "Please upload a document to sign.",
          variant: "destructive",
        });
        return;
      }
      esigData = {
        type: "upload",
        value: uploadedFile.fileId,
        fileName: uploadedFile.fileName,
        signedAt: new Date().toISOString(),
      };
    }

    signMutation.mutate({
      signatureType,
      esigData,
      docRender: finalDocRender,
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
          {signatureType !== "upload" && (
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
          )}

          <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as "canvas" | "typed" | "upload")}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="typed" data-testid="tab-typed">
                <Type className="h-4 w-4 mr-2" />
                Type Name
              </TabsTrigger>
              <TabsTrigger value="canvas" data-testid="tab-canvas">
                <Pen className="h-4 w-4 mr-2" />
                Draw Signature
              </TabsTrigger>
              <TabsTrigger value="upload" data-testid="tab-upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload Document
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

            <TabsContent value="upload" className="mt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Upload a Word or PDF Document</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload a signed document or image (PDF, Word, or common image formats).
                  </p>
                </div>
                
                {!uploadedFile ? (
                  <div className="border-2 border-dashed rounded-md p-6 text-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff,.tif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                      className="hidden"
                      data-testid="input-file-upload"
                    />
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadMutation.isPending}
                      data-testid="button-select-file"
                    >
                      {uploadMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Select File
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      PDF, Word documents, or images up to 20MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border rounded-md p-4 bg-muted/30">
                      <h3 className="font-semibold text-lg mb-2">{docTitle}</h3>
                      <ScrollArea className="h-48">
                        <div 
                          className="prose prose-sm max-w-none dark:prose-invert"
                          dangerouslySetInnerHTML={{ __html: docRender }}
                          data-testid="text-document-content-upload"
                        />
                      </ScrollArea>
                    </div>
                    <div className="border rounded-md p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <span className="font-medium">{uploadedFile.fileName}</span>
                            <p className="text-xs text-muted-foreground">Uploaded document attached as signature</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveFile}
                          data-testid="button-remove-file"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
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
            disabled={
              signMutation.isPending || 
              uploadMutation.isPending ||
              (signatureType === "typed" && !typedName.trim()) ||
              (signatureType === "upload" && !uploadedFile)
            }
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
