import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ClerkProvider, useClerk } from "@clerk/clerk-react";
import { registerClerkSignOut } from "@/contexts/AuthContext";
import { installTimeZoneRedirection } from "@/lib/display-timezone";
import { installPresentationGuard } from "@/lib/presentation-guard";

// Before anything renders, so no date is ever formatted by an unredirected
// path. A no-op for everyone whose display zone is their own browser's.
installTimeZoneRedirection();

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ClerkSignOutRegistrar({ children }: { children: React.ReactNode }) {
  const { signOut } = useClerk();
  useEffect(() => {
    registerClerkSignOut(signOut);
    return () => registerClerkSignOut(null);
  }, [signOut]);
  return <>{children}</>;
}

function Root() {
  if (CLERK_PUBLISHABLE_KEY) {
    return (
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/api/logout">
        <ClerkSignOutRegistrar>
          <App />
        </ClerkSignOutRegistrar>
      </ClerkProvider>
    );
  }

  return <App />;
}

// No auth provider, application query or third-party injection mounts until
// authoritative presentation state has been confirmed.
void installPresentationGuard().then(allowed => {
  if (allowed) createRoot(document.getElementById("root")!).render(<Root />);
});
