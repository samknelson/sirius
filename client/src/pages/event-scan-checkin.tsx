import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CheckCircle, XCircle, ArrowLeft, Scan, UserCheck } from "lucide-react";

interface Event {
  id: string;
  title: string;
  eventTypeId: string;
}

interface ScanResult {
  success: boolean;
  message: string;
  workerName?: string;
  alreadyRegistered?: boolean;
}

interface QRPayload {
  type: string;
  workerId: string;
  timestamp: number;
}

export default function EventScanCheckin() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const { toast } = useToast();
  
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const scannerContainerId = "qr-scanner-container";

  const { data: event, isLoading: eventLoading, error: eventError } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: !!eventId,
  });

  const checkinMutation = useMutation({
    mutationFn: async (payload: QRPayload) => {
      return await apiRequest("POST", `/api/events/${eventId}/scan-checkin`, payload);
    },
    onSuccess: (data: ScanResult) => {
      setLastScanResult(data);
      if (data.success) {
        toast({
          title: data.alreadyRegistered ? "Already Registered" : "Check-in Successful",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/participants`] });
      } else {
        toast({
          title: "Check-in Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      setLastScanResult({
        success: false,
        message: error.message || "Failed to process check-in",
      });
      toast({
        title: "Check-in Error",
        description: error.message || "Failed to process check-in",
        variant: "destructive",
      });
    },
  });

  const startScanning = async () => {
    setCameraError(null);
    setLastScanResult(null);
    
    try {
      const scanner = new Html5Qrcode(scannerContainerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {}
      );
      
      setIsScanning(true);
    } catch (err: any) {
      console.error("Camera error:", err);
      setCameraError(err.message || "Failed to access camera");
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (err) {
        console.error("Error stopping scanner:", err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  const handleScan = async (decodedText: string) => {
    // Prevent multiple simultaneous scans
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    try {
      const payload: QRPayload = JSON.parse(decodedText);
      
      if (payload.type !== "sirius-event-checkin") {
        setLastScanResult({
          success: false,
          message: "Invalid QR code type",
        });
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }

      if (!payload.workerId || !payload.timestamp) {
        setLastScanResult({
          success: false,
          message: "Invalid QR code data",
        });
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const ageSeconds = now - payload.timestamp;
      
      if (ageSeconds > 90) {
        setLastScanResult({
          success: false,
          message: "QR code has expired. Please ask the worker to refresh their code.",
        });
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }

      if (ageSeconds < -10) {
        setLastScanResult({
          success: false,
          message: "QR code timestamp is invalid",
        });
        processingRef.current = false;
        setIsProcessing(false);
        return;
      }

      // Stop scanning before submitting to prevent duplicates
      await stopScanning();
      
      checkinMutation.mutate(payload, {
        onSettled: () => {
          processingRef.current = false;
          setIsProcessing(false);
        }
      });
    } catch (err) {
      setLastScanResult({
        success: false,
        message: "Could not read QR code. Please try again.",
      });
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  if (eventLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading event...</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <p className="text-destructive" data-testid="text-error">
                Event not found or access denied
              </p>
              <Link href="/events">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Events
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-md mx-auto space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Scan className="h-5 w-5" />
                  In-Person Scan
                </CardTitle>
                <CardDescription className="mt-1">
                  {event.title}
                </CardDescription>
              </div>
              <Link href={`/events/${eventId}`}>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              id={scannerContainerId}
              className="w-full aspect-square bg-muted rounded-lg overflow-hidden"
              data-testid="scanner-container"
            />

            {cameraError && (
              <div className="text-center p-4 bg-destructive/10 rounded-lg">
                <XCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive" data-testid="text-camera-error">
                  {cameraError}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Please allow camera access and try again
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!isScanning ? (
                <Button 
                  onClick={startScanning} 
                  className="flex-1"
                  data-testid="button-start-scan"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Start Scanning
                </Button>
              ) : (
                <Button 
                  onClick={stopScanning} 
                  variant="outline" 
                  className="flex-1"
                  data-testid="button-stop-scan"
                >
                  Stop Scanning
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {lastScanResult && (
          <Card data-testid="scan-result-card">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                {lastScanResult.success ? (
                  <CheckCircle className="h-8 w-8 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-8 w-8 text-destructive shrink-0" />
                )}
                <div className="flex-1">
                  <p className="font-medium" data-testid="text-scan-result">
                    {lastScanResult.success ? (
                      lastScanResult.alreadyRegistered ? "Already Registered" : "Check-in Successful"
                    ) : (
                      "Check-in Failed"
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {lastScanResult.message}
                  </p>
                  {lastScanResult.workerName && (
                    <Badge variant="outline" className="mt-2">
                      <UserCheck className="h-3 w-3 mr-1" />
                      {lastScanResult.workerName}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Point the camera at a worker's QR code to check them in
        </p>
      </div>
    </div>
  );
}
