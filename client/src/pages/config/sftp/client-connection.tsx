import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { connectionDataSchema, PROTOCOL_DEFAULTS } from "@shared/schema/system/sftp-client-schema";
import type { ConnectionData } from "@shared/schema/system/sftp-client-schema";

type Protocol = "sftp" | "ftp";

interface FormState {
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  homeDir: string;
  password: string;
  privateKey: string;
  publicKey: string;
  passphrase: string;
  tlsMode: "none" | "implicit" | "explicit";
}

function getDefaultForm(protocol: Protocol): FormState {
  return {
    protocol,
    host: "",
    port: PROTOCOL_DEFAULTS[protocol]?.port ?? 22,
    username: "",
    homeDir: "",
    password: "",
    privateKey: "",
    publicKey: "",
    passphrase: "",
    tlsMode: "none",
  };
}

function formToPayload(form: FormState): ConnectionData {
  if (form.protocol === "sftp") {
    return {
      protocol: "sftp",
      host: form.host,
      port: form.port,
      username: form.username,
      homeDir: form.homeDir,
      password: form.password,
      privateKey: form.privateKey,
      publicKey: form.publicKey,
      passphrase: form.passphrase,
    };
  }
  return {
    protocol: "ftp",
    host: form.host,
    port: form.port,
    username: form.username,
    homeDir: form.homeDir,
    password: form.password,
    tlsMode: form.tlsMode,
  };
}

function parseConnectionData(raw: unknown): ConnectionData | null {
  const result = connectionDataSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function connectionToForm(data: ConnectionData): FormState {
  const base: FormState = {
    protocol: data.protocol,
    host: data.host,
    port: data.port,
    username: data.username ?? "",
    homeDir: data.homeDir ?? "",
    password: data.password ?? "",
    privateKey: "",
    publicKey: "",
    passphrase: "",
    tlsMode: "none",
  };
  if (data.protocol === "sftp") {
    base.privateKey = data.privateKey ?? "";
    base.publicKey = data.publicKey ?? "";
    base.passphrase = data.passphrase ?? "";
  } else {
    base.tlsMode = data.tlsMode ?? "none";
  }
  return base;
}

function ConnectionContent() {
  const { destination } = useSftpClientLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const parsed = parseConnectionData(destination.data);

  const [form, setForm] = useState<FormState>(() =>
    parsed ? connectionToForm(parsed) : getDefaultForm("sftp")
  );

  useEffect(() => {
    const reparsed = parseConnectionData(destination.data);
    if (reparsed) {
      setForm(connectionToForm(reparsed));
    }
  }, [destination.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: ConnectionData) =>
      apiRequest("PUT", `/api/sftp/client-destinations/${destination.id}/connection`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sftp/client-destinations", destination.id] });
      toast({ title: "Connection saved", description: "Connection settings have been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save connection", description: error.message || "An error occurred", variant: "destructive" });
    },
  });

  const handleProtocolChange = (protocol: Protocol) => {
    setForm((prev) => ({
      ...prev,
      protocol,
      port: PROTOCOL_DEFAULTS[protocol]?.port ?? prev.port,
    }));
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.host.trim()) {
      toast({ title: "Validation error", description: "Host is required.", variant: "destructive" });
      return;
    }
    saveMutation.mutate(formToPayload(form));
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-connection">
        <CardHeader>
          <CardTitle>Connection Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="protocol">Protocol</Label>
              <Select value={form.protocol} onValueChange={(v) => handleProtocolChange(v as Protocol)}>
                <SelectTrigger id="protocol" data-testid="select-protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sftp">SFTP (SSH File Transfer)</SelectItem>
                  <SelectItem value="ftp">FTP (File Transfer Protocol)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  value={form.host}
                  onChange={(e) => updateField("host", e.target.value)}
                  placeholder="e.g. sftp.example.com"
                  data-testid="input-host"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => updateField("port", parseInt(e.target.value, 10) || 0)}
                  data-testid="input-port"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  placeholder="Optional"
                  data-testid="input-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="homeDir">Home / Remote Directory</Label>
                <Input
                  id="homeDir"
                  value={form.homeDir}
                  onChange={(e) => updateField("homeDir", e.target.value)}
                  placeholder="e.g. /uploads"
                  data-testid="input-home-dir"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  placeholder="Optional"
                  className="pr-10"
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {form.protocol === "sftp" && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-medium text-muted-foreground">SSH Key Authentication</h3>
                <div className="space-y-2">
                  <Label htmlFor="privateKey">Private Key</Label>
                  <Textarea
                    id="privateKey"
                    value={form.privateKey}
                    onChange={(e) => updateField("privateKey", e.target.value)}
                    placeholder="Paste PEM-encoded private key..."
                    className="font-mono text-xs min-h-[100px]"
                    data-testid="input-private-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publicKey">Public Key</Label>
                  <Textarea
                    id="publicKey"
                    value={form.publicKey}
                    onChange={(e) => updateField("publicKey", e.target.value)}
                    placeholder="Paste public key (optional)..."
                    className="font-mono text-xs min-h-[80px]"
                    data-testid="input-public-key"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="passphrase">Key Passphrase</Label>
                  <div className="relative">
                    <Input
                      id="passphrase"
                      type={showPassphrase ? "text" : "password"}
                      value={form.passphrase}
                      onChange={(e) => updateField("passphrase", e.target.value)}
                      placeholder="Optional"
                      className="pr-10"
                      data-testid="input-passphrase"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      data-testid="button-toggle-passphrase"
                    >
                      {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {form.protocol === "ftp" && (
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-medium text-muted-foreground">TLS / Security</h3>
                <div className="space-y-2">
                  <Label htmlFor="tlsMode">TLS Mode</Label>
                  <Select value={form.tlsMode} onValueChange={(v) => updateField("tlsMode", v as FormState["tlsMode"])}>
                    <SelectTrigger id="tlsMode" data-testid="select-tls-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (plain FTP)</SelectItem>
                      <SelectItem value="explicit">Explicit TLS (FTPES)</SelectItem>
                      <SelectItem value="implicit">Implicit TLS (FTPS)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t">
              <Button
                type="submit"
                disabled={saveMutation.isPending || !form.host.trim()}
                data-testid="button-save-connection"
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Connection
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SftpClientConnectionPage() {
  return (
    <SftpClientLayout activeTab="connection">
      <ConnectionContent />
    </SftpClientLayout>
  );
}
