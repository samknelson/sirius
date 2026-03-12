import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import App from "./App";
import "./index.css";
import { ClerkProvider, useClerk } from "@clerk/clerk-react";
import { registerClerkSignOut } from "@/contexts/AuthContext";

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

createRoot(document.getElementById("root")!).render(<Root />);
