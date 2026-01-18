import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QRCodeSVG } from "qrcode.react";
import { useState, useEffect, useMemo } from "react";
import { QrCode, RefreshCw, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

function generateQRPayload(workerId: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    type: "sirius-event-checkin",
    workerId,
    timestamp,
  });
}

export default function WorkerQRCode() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(60);

  const { user, isLoading } = useAuth();

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      setRefreshKey((prev) => prev + 1);
      setSecondsUntilRefresh(60);
    }, 60000);

    const countdownInterval = setInterval(() => {
      setSecondsUntilRefresh((prev) => (prev > 0 ? prev - 1 : 60));
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
    };
  }, []);

  const qrPayload = useMemo(() => {
    if (!user?.workerId) return null;
    return generateQRPayload(user.workerId);
  }, [user?.workerId, refreshKey]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!user?.workerId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Event Check-in QR Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center text-muted-foreground py-8" data-testid="text-no-worker">
              Your account is not linked to a worker record. Please contact an administrator.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <QrCode className="h-5 w-5" />
            Event Check-in
          </CardTitle>
          <CardDescription>
            Show this QR code to the event administrator to check in
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center">
            <div className="bg-white p-4 rounded-lg" data-testid="qr-code-container">
              {qrPayload && (
                <QRCodeSVG
                  value={qrPayload}
                  size={256}
                  level="M"
                  includeMargin={false}
                />
              )}
            </div>
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm font-medium" data-testid="text-user-name">
              {user.firstName} {user.lastName}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              <span>Auto-refreshes for security</span>
            </div>
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground" data-testid="text-countdown">
              <Clock className="h-3 w-3" />
              <span>Next refresh in {secondsUntilRefresh}s</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
