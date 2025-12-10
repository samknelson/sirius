import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Esig, File as FileRecord } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, FileSignature, Calendar, Hash, Shield, FileText, Download, User, Mail, Key, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

async function computeSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

interface EsigViewProps {
  esigId: string;
}

interface EsigData {
  type: "canvas" | "typed" | "upload";
  value: string;
  fileName?: string;
  signedAt?: string;
}

interface EsigSigner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface EsigWithSigner extends Esig {
  signer?: EsigSigner;
}

export function EsigView({ esigId }: EsigViewProps) {
  const { data: esig, isLoading, error } = useQuery<EsigWithSigner>({
    queryKey: ["/api/esigs", esigId],
    enabled: !!esigId,
  });

  const [hashVerification, setHashVerification] = useState<{
    verified: boolean;
    computedHash: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function verifyHash() {
      if (!esig?.docRender || !esig?.docHash) {
        setHashVerification(null);
        return;
      }

      setVerifying(true);
      try {
        const computedHash = await computeSha256(esig.docRender);
        setHashVerification({
          verified: computedHash === esig.docHash,
          computedHash,
        });
      } catch (err) {
        console.error("Hash verification failed:", err);
        setHashVerification(null);
      } finally {
        setVerifying(false);
      }
    }

    verifyHash();
  }, [esig?.docRender, esig?.docHash]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !esig) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Failed to load signature record.</p>
        </CardContent>
      </Card>
    );
  }

  const esigData = esig.esig as EsigData | null;

  return (
    <div className="space-y-6">
      {hashVerification !== null && !hashVerification.verified && (
        <Alert variant="destructive" data-testid="alert-hash-mismatch">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Document Integrity Warning</AlertTitle>
          <AlertDescription>
            The document hash does not match the stored hash. This document may have been modified after signing.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5" />
            Signed Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          {esig.docRender ? (
            <div 
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: esig.docRender }}
              data-testid="text-signed-document"
            />
          ) : (
            <p className="text-muted-foreground">No document content available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Signature Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {esig.signer && (
            <>
              <div className="space-y-3">
                <label className="text-sm font-medium text-muted-foreground">Signed By</label>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      Name
                    </label>
                    <p className="text-foreground" data-testid="text-signer-name">
                      {esig.signer.firstName || esig.signer.lastName 
                        ? `${esig.signer.firstName || ""} ${esig.signer.lastName || ""}`.trim()
                        : "Unknown"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Mail className="h-3 w-3" />
                      Email
                    </label>
                    <p className="text-foreground" data-testid="text-signer-email">
                      {esig.signer.email}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Key className="h-3 w-3" />
                      UUID
                    </label>
                    <p className="text-foreground font-mono text-xs break-all" data-testid="text-signer-uuid">
                      {esig.signer.id}
                    </p>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                Signed Date
              </label>
              <p className="text-foreground" data-testid="text-esig-signed-date">
                {esig.signedDate 
                  ? format(new Date(esig.signedDate), "MMMM d, yyyy 'at' h:mm a") 
                  : "Unknown"}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <Hash className="h-4 w-4" />
                Document Hash
                {verifying && <Loader2 className="h-3 w-3 animate-spin" />}
                {hashVerification !== null && (
                  hashVerification.verified ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" data-testid="icon-hash-verified" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" data-testid="icon-hash-mismatch" />
                  )
                )}
              </label>
              <p className="text-foreground font-mono text-xs break-all" data-testid="text-esig-hash">
                {esig.docHash || "No hash available"}
              </p>
              {hashVerification !== null && !hashVerification.verified && (
                <p className="text-xs text-destructive mt-1" data-testid="text-computed-hash">
                  Computed: {hashVerification.computedHash}
                </p>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground">Signature</label>
            <SignatureDisplay esigData={esigData} />
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {esig.type || "online"}
            </Badge>
            {esig.docType && (
              <Badge variant="secondary" className="text-xs">
                {esig.docType}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SignatureDisplayProps {
  esigData: EsigData | null;
}

function SignatureDisplay({ esigData }: SignatureDisplayProps) {
  if (!esigData) {
    return (
      <div className="p-4 border rounded-md bg-muted/50">
        <p className="text-muted-foreground text-sm">No signature data available.</p>
      </div>
    );
  }

  if (esigData.type === "canvas" && esigData.value) {
    return (
      <div className="border rounded-md p-4 bg-white dark:bg-zinc-900" data-testid="display-signature-canvas">
        <img 
          src={esigData.value} 
          alt="Signature" 
          className="max-h-32 object-contain"
        />
      </div>
    );
  }

  if (esigData.type === "typed" && esigData.value) {
    return (
      <div className="border rounded-md p-4 bg-white dark:bg-zinc-900" data-testid="display-signature-typed">
        <p 
          className="text-2xl italic text-foreground"
          style={{ fontFamily: "'Dancing Script', cursive, serif" }}
        >
          {esigData.value}
        </p>
      </div>
    );
  }

  if (esigData.type === "upload" && esigData.value) {
    return <UploadSignatureDisplay fileId={esigData.value} fileName={esigData.fileName} />;
  }

  return (
    <div className="p-4 border rounded-md bg-muted/50">
      <p className="text-muted-foreground text-sm">Signature format not recognized.</p>
    </div>
  );
}

function UploadSignatureDisplay({ fileId, fileName }: { fileId: string; fileName?: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lowerFileName = fileName?.toLowerCase() || "";
  const isPdf = lowerFileName.endsWith(".pdf");
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"].some(
    ext => lowerFileName.endsWith(ext)
  );
  const hasPreview = isPdf || isImage;

  useEffect(() => {
    async function fetchUrl() {
      try {
        setIsLoadingUrl(true);
        const response = await fetch(`/api/files/${fileId}/url`);
        if (!response.ok) {
          throw new Error("Failed to get file URL");
        }
        const data = await response.json();
        setPreviewUrl(data.url);
      } catch (err) {
        console.error("Failed to get file URL:", err);
        setError("Could not load preview");
      } finally {
        setIsLoadingUrl(false);
      }
    }
    fetchUrl();
  }, [fileId]);

  const handleDownload = () => {
    if (previewUrl) {
      window.open(previewUrl, "_blank");
    }
  };

  return (
    <div className="border rounded-md p-4 bg-white dark:bg-zinc-900 space-y-3" data-testid="display-signature-upload">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{fileName || "Uploaded Document"}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={!previewUrl}
          data-testid="button-download-signed-document"
        >
          <Download className="h-4 w-4 mr-1" />
          Download
        </Button>
      </div>

      {hasPreview && (
        <div className="border rounded-md overflow-hidden bg-muted/30">
          {isLoadingUrl ? (
            <div className="h-48 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              {error}
            </div>
          ) : previewUrl ? (
            isPdf ? (
              <iframe
                src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                className="w-full h-48 border-0"
                title="PDF Preview"
                data-testid="iframe-pdf-preview"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Uploaded document"
                className="w-full h-48 object-contain"
                data-testid="img-preview"
              />
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
