import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface RecordMetadataAccessProps {
  children: ReactNode;
  /** Web-service screens are already admin-only and retain that admin bypass. */
  adminBypass?: boolean;
}

/**
 * Hide inline provenance from surfaces that are not the record-history badge.
 * The server remains authoritative; this prevents unauthorized UI from
 * rendering while the permission-aware data hooks stay disabled.
 */
export function RecordMetadataAccess({
  children,
  adminBypass = false,
}: RecordMetadataAccessProps) {
  const { hasPermission } = useAuth();
  const allowed =
    hasPermission("metadata.view") ||
    (adminBypass && hasPermission("admin"));

  return allowed ? <>{children}</> : null;
}