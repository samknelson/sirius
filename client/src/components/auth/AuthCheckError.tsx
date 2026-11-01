import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthCheckError() {
  const { retryAuth, isCheckingAuth } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" role="alert">
        <CardHeader><CardTitle>Unable to check your sign-in</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p>We could not reach or read the sign-in service. This does not mean you have been signed out. Check your connection and try again.</p>
          <Button onClick={retryAuth} disabled={isCheckingAuth}>
            {isCheckingAuth ? "Checking…" : "Try again"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
