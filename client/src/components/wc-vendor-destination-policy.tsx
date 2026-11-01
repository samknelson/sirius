import { Badge } from "@/components/ui/badge";
import type { WcVendorDestinationPolicyView } from "@shared/webclient-destination-policy";

export function WcVendorDestinationPolicy({
  policy,
  loading = false,
  error = false,
}: {
  policy?: WcVendorDestinationPolicyView;
  loading?: boolean;
  error?: boolean;
}) {
  if (loading) {
    return (
      <section className="mt-4 border-t pt-3" aria-live="polite" data-testid="destination-policy-loading">
        <p className="font-medium">Effective destination policy</p>
        <p className="mt-1 text-muted-foreground">Refreshing policy from the current process…</p>
      </section>
    );
  }

  if (error || !policy) {
    return (
      <section className="mt-4 border-t pt-3" aria-live="polite" data-testid="destination-policy-error">
        <p className="font-medium">Effective destination policy</p>
        <p className="mt-1 text-muted-foreground">
          {error
            ? "Could not refresh the manifest. Effective policy is not shown; close and reopen to retry."
            : "No effective destination policy was supplied by this manifest."}
        </p>
      </section>
    );
  }

  const selectionLabel = {
    replacement: "Replacement policy",
    manifest: "Manifest defaults",
    none: "No restriction configured",
    invalid: "Invalid policy configuration",
  }[policy.selection];

  const statusLabel = {
    restricted: "Restricted",
    "deny-all": "Deny all",
    unrestricted: "Unrestricted",
    invalid: "Invalid",
  }[policy.status];

  const transportDescription = {
    "guarded-http":
      `Guarded HTTP: HTTPS and port 443 are required, ${policy.allowPrivateAddresses === true ? "public and ordinary private addresses are permitted" : "public-network checks apply"}, and redirects are not followed. Metadata, loopback and link-local destinations remain blocked. Unrestricted policy here does not mean arbitrary network access.`,
    unsupported:
      "Unsupported transport: the SDK or browser cannot enforce the active policy. Calls are refused before the browser is launched.",
    unguarded:
      "Unguarded transport: the SDK or browser has no active destination restriction and is not covered by the guarded HTTP baseline.",
    local: "Local transport: this plugin does not contact an external service.",
  }[policy.transport];

  return (
    <section className="mt-4 border-t pt-3 text-sm" data-testid="destination-policy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Effective destination policy</p>
        <Badge variant={policy.status === "invalid" ? "destructive" : "secondary"}>
          {statusLabel}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">Plugin ID</dt>
        <dd className="break-all font-mono text-xs">{policy.pluginId}</dd>
        <dt className="text-muted-foreground">Allowlist required</dt>
        <dd>{policy.requiresAllowlist ? "Yes" : "No"}</dd>
        <dt className="text-muted-foreground">Selection</dt>
        <dd>{selectionLabel}</dd>
        <dt className="text-muted-foreground">Network access</dt>
        <dd>{policy.allowPrivateAddresses === null ? "Unavailable (invalid policy)"
          : policy.allowPrivateAddresses ? "Public and private addresses" : "Public addresses only"}</dd>
        <dt className="text-muted-foreground">Configuration source</dt>
        <dd>
          {policy.configurationSource === null
            ? "No policy map configured"
            : policy.configurationSource === "environment"
              ? "Environment"
              : "In-app override"}
        </dd>
        <dt className="text-muted-foreground">Policy editing</dt>
        <dd>
          {policy.deploymentLocked
            ? "Whole policy map is deployment-locked"
            : "In-app policy editing is available"}
        </dd>
      </dl>

      {policy.selection === "replacement" && (
        <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          Replacement patterns replace manifest defaults; they do not extend them.
        </p>
      )}
      {policy.status === "deny-all" && (
        <p className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          Deny-all blocks all destinations.
        </p>
      )}
      {policy.status === "invalid" && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          Invalid configuration refuses operations.
        </p>
      )}

      <div className="mt-3">
        <p className="text-muted-foreground">Effective normalized patterns</p>
        {policy.effectivePatterns === null ? (
          <p className="mt-1 text-xs">
            {policy.status === "unrestricted"
              ? "No destination pattern restriction is active."
              : "No effective patterns are available."}
          </p>
        ) : policy.effectivePatterns.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {policy.effectivePatterns.map((pattern, index) => (
              <li
                key={`${index}:${pattern}`}
                className="break-all rounded border bg-muted/40 px-2 py-1 font-mono text-xs"
              >
                {pattern}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs">No patterns are permitted.</p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{transportDescription}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Policy applies per plugin across all of its connections, not to unsaved
        configuration fields. This is a current-process snapshot; in-app
        overrides follow the normal override-cache refresh timing. Policies are
        displayed here and are not edited in this dialog.
      </p>
    </section>
  );
}
