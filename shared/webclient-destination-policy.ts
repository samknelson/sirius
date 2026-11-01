/** Credential-free, read-only description of the running process's policy. */
export interface WcVendorDestinationPolicyView {
  pluginId: string;
  requiresAllowlist: boolean;
  configurationSource: "environment" | "override" | null;
  deploymentLocked: boolean;
  selection: "replacement" | "manifest" | "none" | "invalid";
  status: "restricted" | "deny-all" | "unrestricted" | "invalid";
  effectivePatterns: readonly string[] | null;
  /** Null when configuration is invalid and no effective policy exists. */
  allowPrivateAddresses: boolean | null;
  transport: "guarded-http" | "unsupported" | "unguarded" | "local";
}
