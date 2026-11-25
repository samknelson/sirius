import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { clearAllFeatureHistory, effectiveIdentity } from "./history";

/**
 * Mounted at the app root so feature transcripts are purged even when the chat
 * route is not currently open. Initial auth resolution is a baseline only:
 * existing history remains untouched until the chat page verifies its context.
 */
export function ContractChatLifecycle() {
  const { user, authReady, isAuthenticated, masquerade } = useAuth();
  const identity = authReady && isAuthenticated && user
    ? effectiveIdentity(
        String(user.id),
        masquerade.isMasquerading,
        masquerade.originalUser?.id,
      )
    : null;
  const previousIdentity = useRef<string | null>(null);
  const hasResolvedInitialIdentity = useRef(false);

  useEffect(() => {
    const onSessionEnded = () => {
      clearAllFeatureHistory();
      previousIdentity.current = null;
      hasResolvedInitialIdentity.current = true;
    };
    window.addEventListener("auth:session-ended", onSessionEnded);
    return () => window.removeEventListener("auth:session-ended", onSessionEnded);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!hasResolvedInitialIdentity.current) {
      previousIdentity.current = identity;
      hasResolvedInitialIdentity.current = true;
      return;
    }
    if (previousIdentity.current !== identity) clearAllFeatureHistory();
    previousIdentity.current = identity;
  }, [authReady, identity]);

  return null;
}

export default ContractChatLifecycle;
