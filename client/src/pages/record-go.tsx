import { type FormEvent, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { recordGoHref } from "@shared/utils/record-go";

export function recordGoDestination(identifier: string): { href: string } | { error: string } {
  const value = identifier.trim();
  if (!value) {
    return { error: "Enter a record ID, metadata ID, or record sequence." };
  }
  return { href: recordGoHref(value) };
}

export default function RecordGoPage() {
  usePageTitle("Go to record");
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination = recordGoDestination(identifier);
    if ("error" in destination) {
      setError(destination.error);
      return;
    }

    setError(null);
    window.location.assign(destination.href);
  };

  return (
    <div className="min-h-[calc(100vh-10rem)] flex items-start justify-center p-6 md:p-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Go to record</CardTitle>
          <CardDescription>
            Paste a record ID, metadata ID, sequence number, or copied record badge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="record-go-identifier" className="text-sm font-medium">
                Record identifier
              </label>
              <Input
                id="record-go-identifier"
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. 000.0123::0002"
                autoFocus
                aria-invalid={!!error}
                aria-describedby={error ? "record-go-error" : undefined}
                data-testid="input-record-go-identifier"
              />
            </div>
            {error && (
              <Alert variant="destructive" id="record-go-error" data-testid="alert-record-go-error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" data-testid="button-record-go-submit">
              Open record
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}