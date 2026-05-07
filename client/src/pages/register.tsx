import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, AlertCircle, ArrowLeft, UserPlus, CheckCircle2, Eye, EyeOff, LogIn } from "lucide-react";
import { SignUp, useUser } from "@clerk/clerk-react";

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

type Step = "verify" | "signup" | "completing";
type ProviderInfo = { type: string; isDefault: boolean };

function useRegistrationContext() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [workerRegistrationEnabled, setWorkerRegistrationEnabled] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { providers: [], workerRegistrationEnabled: false }))
      .then((data) => {
        if (cancelled) return;
        setProviders(data.providers || []);
        setWorkerRegistrationEnabled(!!data.workerRegistrationEnabled);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([]);
        setWorkerRegistrationEnabled(false);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { providers, workerRegistrationEnabled, loaded };
}

export default function RegisterPage() {
  const [, setLocation] = useLocation();
  const { providers, workerRegistrationEnabled, loaded } = useRegistrationContext();

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const oktaEnabled = providers.some((p) => p.type === "okta");

  if (!workerRegistrationEnabled || (!CLERK_ENABLED && !oktaEnabled)) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }

  if (CLERK_ENABLED) {
    return <ClerkRegisterFlow />;
  }

  return <OktaRegisterFlow />;
}

function VerifyForm({
  firstName,
  lastName,
  ssn,
  dateOfBirth,
  showSSN,
  isSubmitting,
  error,
  onChange,
  onToggleSSN,
  onSubmit,
  onBack,
}: {
  firstName: string;
  lastName: string;
  ssn: string;
  dateOfBirth: string;
  showSSN: boolean;
  isSubmitting: boolean;
  error: string | null;
  onChange: (field: "firstName" | "lastName" | "ssn" | "dateOfBirth", value: string) => void;
  onToggleSSN: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-2">
          <div className="p-3 bg-primary/10 rounded-full">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold" data-testid="text-register-title">
          Register as a Worker
        </CardTitle>
        <CardDescription>
          Step 1 of 2: First, verify your identity using the information on file with us.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => onChange("firstName", e.target.value)}
                placeholder="First name"
                required
                disabled={isSubmitting}
                data-testid="input-register-firstname"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => onChange("lastName", e.target.value)}
                placeholder="Last name"
                required
                disabled={isSubmitting}
                data-testid="input-register-lastname"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ssn">Social Security Number</Label>
            <div className="relative">
              <Input
                id="ssn"
                type={showSSN ? "text" : "password"}
                value={ssn}
                onChange={(e) => onChange("ssn", e.target.value)}
                placeholder="XXX-XX-XXXX"
                required
                disabled={isSubmitting}
                autoComplete="off"
                className="pr-10"
                data-testid="input-register-ssn"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={onToggleSSN}
                tabIndex={-1}
                data-testid="button-toggle-ssn"
              >
                {showSSN ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">Date of Birth</Label>
            <Input
              id="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => onChange("dateOfBirth", e.target.value)}
              required
              disabled={isSubmitting}
              data-testid="input-register-dob"
            />
          </div>

          {error && (
            <Alert variant="destructive" data-testid="text-register-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isSubmitting}
            data-testid="button-register-verify"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-5 w-5" />
                Verify My Identity
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onBack}
            disabled={isSubmitting}
            data-testid="button-register-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sign In
          </Button>
        </form>

        <div className="mt-4 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            Your information is verified securely and is not stored beyond
            what is already in our system.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatSSNInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function useVerifyState() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ssn, setSsn] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [showSSN, setShowSSN] = useState(false);
  const onChange = (field: "firstName" | "lastName" | "ssn" | "dateOfBirth", value: string) => {
    if (field === "firstName") setFirstName(value);
    else if (field === "lastName") setLastName(value);
    else if (field === "ssn") setSsn(formatSSNInput(value));
    else if (field === "dateOfBirth") setDateOfBirth(value);
  };
  return { firstName, lastName, ssn, dateOfBirth, showSSN, setShowSSN, onChange };
}

function ClerkRegisterFlow() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const { isSignedIn } = useUser();

  const [step, setStep] = useState<Step>("verify");
  const verify = useVerifyState();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifiedName, setVerifiedName] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

  useEffect(() => {
    if (isSignedIn && (step === "signup" || step === "verify")) {
      completeRegistration();
    }
  }, [isSignedIn, step]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/pre-verify-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: verify.firstName,
          lastName: verify.lastName,
          ssn: verify.ssn,
          dateOfBirth: verify.dateOfBirth,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || "Verification failed. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setVerifiedName(data.workerName || `${verify.firstName} ${verify.lastName}`);
      setStep("signup");
      setIsSubmitting(false);
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  const completeRegistration = async () => {
    setStep("completing");
    setError(null);
    try {
      const response = await fetch("/api/auth/complete-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: verify.firstName,
          lastName: verify.lastName,
          ssn: verify.ssn,
          dateOfBirth: verify.dateOfBirth,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 400 && data.message?.includes("No verified identity")) {
          setError("Your verification session has expired. Please verify your identity again.");
          setStep("verify");
          return;
        }
        if (response.status === 400 && data.message?.includes("Already provisioned")) {
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          setLocation("/dashboard");
          return;
        }
        setError(data.message || "Registration failed. Please try again.");
        setStep("signup");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/dashboard");
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setStep("signup");
    }
  };

  if (isAuthenticated) return null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      {step === "verify" && (
        <VerifyForm
          firstName={verify.firstName}
          lastName={verify.lastName}
          ssn={verify.ssn}
          dateOfBirth={verify.dateOfBirth}
          showSSN={verify.showSSN}
          isSubmitting={isSubmitting}
          error={error}
          onChange={verify.onChange}
          onToggleSSN={() => verify.setShowSSN(!verify.showSSN)}
          onSubmit={handleVerify}
          onBack={() => setLocation("/login")}
        />
      )}

      {step === "signup" && (
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold" data-testid="text-register-signup-title">
              Identity Verified
            </CardTitle>
            <CardDescription>
              Welcome, {verifiedName}! Step 2 of 2: Create your login account below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" data-testid="text-register-signup-error">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-center">
              <SignUp
                routing="virtual"
                fallbackRedirectUrl="/register"
                signInUrl="/login"
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    card: "shadow-none p-0 w-full",
                    headerTitle: "hidden",
                    headerSubtitle: "hidden",
                    socialButtonsBlockButton: "min-h-9",
                    formButtonPrimary: "min-h-9",
                  },
                }}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setStep("verify");
                setError(null);
              }}
              data-testid="button-register-back-to-verify"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Identity Verification
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "completing" && <CompletingCard />}
    </div>
  );
}

function OktaRegisterFlow() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  const [step, setStep] = useState<Step>("verify");
  const verify = useVerifyState();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifiedName, setVerifiedName] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/pre-verify-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: verify.firstName,
          lastName: verify.lastName,
          ssn: verify.ssn,
          dateOfBirth: verify.dateOfBirth,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || "Verification failed. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setVerifiedName(data.workerName || `${verify.firstName} ${verify.lastName}`);
      setStep("signup");
      setIsSubmitting(false);
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleContinueToOkta = () => {
    setStep("completing");
    window.location.href = "/api/login?provider=okta";
  };

  if (isAuthenticated) return null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      {step === "verify" && (
        <VerifyForm
          firstName={verify.firstName}
          lastName={verify.lastName}
          ssn={verify.ssn}
          dateOfBirth={verify.dateOfBirth}
          showSSN={verify.showSSN}
          isSubmitting={isSubmitting}
          error={error}
          onChange={verify.onChange}
          onToggleSSN={() => verify.setShowSSN(!verify.showSSN)}
          onSubmit={handleVerify}
          onBack={() => setLocation("/login")}
        />
      )}

      {step === "signup" && (
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold" data-testid="text-register-signup-title">
              Identity Verified
            </CardTitle>
            <CardDescription>
              Welcome, {verifiedName}! Step 2 of 2: Sign in or create your account with Okta to finish linking it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" data-testid="text-register-signup-error">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="button"
              className="w-full"
              size="lg"
              onClick={handleContinueToOkta}
              data-testid="button-register-continue-okta"
            >
              <LogIn className="mr-2 h-5 w-5" />
              Continue with Okta
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              You'll be redirected to Okta to sign in or create your Okta
              account, then sent back here to finish setup.
            </p>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setStep("verify");
                setError(null);
              }}
              data-testid="button-register-back-to-verify"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Identity Verification
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "completing" && <CompletingCard />}
    </div>
  );
}

function CompletingCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-2">
          <div className="p-3 bg-primary/10 rounded-full">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">
          Setting Up Your Account
        </CardTitle>
        <CardDescription>
          Please wait while we finish connecting your account...
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </CardContent>
    </Card>
  );
}
