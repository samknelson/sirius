import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { connectionDataSchema, PROTOCOL_DEFAULTS } from "@shared/schema/system/sftp-client-schema";
import type { ConnectionData } from "@shared/schema/system/sftp-client-schema";

function ConnectionSummary({ rawData }: { rawData: unknown }) {
  const result = connectionDataSchema.safeParse(rawData);
  if (!result.success) {
    return (
      <p className="text-sm text-muted-foreground italic" data-testid="text-no-connection">
        No connection configured
      </p>
    );
  }

  const data: ConnectionData = result.data;
  const protocolLabel = PROTOCOL_DEFAULTS[data.protocol]?.label ?? data.protocol.toUpperCase();
  const hasPassword = !!data.password;
  const hasPrivateKey = data.protocol === "sftp" && !!data.privateKey;
  const hasPublicKey = data.protocol === "sftp" && !!data.publicKey;
  const hasPassphrase = data.protocol === "sftp" && !!data.passphrase;

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Protocol</dt>
        <dd className="mt-1 text-sm" data-testid="text-conn-protocol">{protocolLabel}</dd>
      </div>
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Host</dt>
        <dd className="mt-1 text-sm" data-testid="text-conn-host">
          {data.host || <span className="text-muted-foreground">—</span>}
        </dd>
      </div>
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Port</dt>
        <dd className="mt-1 text-sm" data-testid="text-conn-port">{data.port}</dd>
      </div>
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Username</dt>
        <dd className="mt-1 text-sm" data-testid="text-conn-username">
          {data.username || <span className="text-muted-foreground">—</span>}
        </dd>
      </div>
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Home Directory</dt>
        <dd className="mt-1 text-sm font-mono" data-testid="text-conn-homedir">
          {data.homeDir || <span className="text-muted-foreground font-sans">—</span>}
        </dd>
      </div>
      <div>
        <dt className="text-sm font-medium text-muted-foreground">Password</dt>
        <dd className="mt-1 text-sm" data-testid="text-conn-password">
          {hasPassword ? "••••••••" : <span className="text-muted-foreground">Not set</span>}
        </dd>
      </div>
      {data.protocol === "sftp" && (
        <>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Private Key</dt>
            <dd className="mt-1 text-sm" data-testid="text-conn-private-key">
              {hasPrivateKey ? "Configured" : <span className="text-muted-foreground">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Public Key</dt>
            <dd className="mt-1 text-sm" data-testid="text-conn-public-key">
              {hasPublicKey ? "Configured" : <span className="text-muted-foreground">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Key Passphrase</dt>
            <dd className="mt-1 text-sm" data-testid="text-conn-passphrase">
              {hasPassphrase ? "••••••••" : <span className="text-muted-foreground">Not set</span>}
            </dd>
          </div>
        </>
      )}
      {data.protocol === "ftp" && (
        <div>
          <dt className="text-sm font-medium text-muted-foreground">TLS Mode</dt>
          <dd className="mt-1 text-sm" data-testid="text-conn-tls">
            {data.tlsMode === "explicit" ? "Explicit TLS (FTPES)" : data.tlsMode === "implicit" ? "Implicit TLS (FTPS)" : "None (plain FTP)"}
          </dd>
        </div>
      )}
    </dl>
  );
}

function DetailsContent() {
  const { destination } = useSftpClientLayout();

  return (
    <div className="space-y-6">
      <Card data-testid="card-details">
        <CardHeader>
          <CardTitle>Destination Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-name">{destination.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Sirius ID</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-sirius-id">
                {destination.siriusId || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-active">
                {destination.active ? "Active" : "Inactive"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Description</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-description">
                {destination.description || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card data-testid="card-connection-summary">
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent>
          <ConnectionSummary rawData={destination.data} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SftpClientDetailsPage() {
  return (
    <SftpClientLayout activeTab="details">
      <DetailsContent />
    </SftpClientLayout>
  );
}
