import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { MessageDefaultsSettings } from "@/components/comm/MessageDefaultsSettings";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ReturnAddress = {
  name: string; company: string; addressLine1: string; addressLine2: string;
  city: string; state: string; zip: string; country: string;
};
const emptyAddress: ReturnAddress = {
  name: "", company: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "", country: "US",
};
const labels: Record<keyof ReturnAddress, string> = {
  name: "Name", company: "Company", addressLine1: "Address Line 1", addressLine2: "Address Line 2",
  city: "City", state: "State", zip: "ZIP", country: "Country",
};

export default function PostalConfigPage() {
  usePageTitle("Postal Settings");
  const { toast } = useToast();
  const [address, setAddress] = useState(emptyAddress);
  const query = useQuery<{ configId: string; configName?: string; returnAddress?: Partial<ReturnAddress> }>({
    queryKey: ["/api/config/postal/return-address"],
  });
  useEffect(() => {
    if (query.data) setAddress({ ...emptyAddress, ...query.data.returnAddress });
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/config/postal/return-address", {
      configId: query.data?.configId, returnAddress: address,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config/postal/return-address"] });
      toast({ title: "Return address saved" });
    },
    onError: (error) => toast({ title: "Unable to save return address", description: getApiErrorMessage(error, "Unable to save return address."), variant: "destructive" }),
  });
  return (
    <div className="space-y-6">
      <h2 className="text-xl md:text-2xl font-bold" data-testid="heading-postal-config">Postal Configuration</h2>
      <p className="text-muted-foreground">
        Manage delivery connections, credentials, operation assignments and provider tests in{" "}
        <Link href="/admin/plugin-configs/wc-vendors" className="text-primary underline">Webclient vendor connections</Link>.
        {" "}Letterhead, footer and page numbering below apply to all letters.
      </p>
      <MessageDefaultsSettings channel="postal" />
      <Card>
        <CardHeader>
          <CardTitle>Default return address</CardTitle>
          <CardDescription>The address for the selected postal delivery connection{query.data?.configName ? ` (${query.data.configName})` : ""}.</CardDescription>
        </CardHeader>
        <CardContent>
          {query.isError ? <p role="alert">{getApiErrorMessage(query.error, "Unable to load return address.")}</p> : (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
              <div className="grid gap-4 md:grid-cols-2">
                {(Object.keys(labels) as (keyof ReturnAddress)[]).map((key) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`return-${key}`}>{labels[key]}</Label>
                    <Input id={`return-${key}`} value={address[key]} disabled={query.isPending || save.isPending}
                      required={!["name", "company", "addressLine2"].includes(key)}
                      onChange={(event) => setAddress({ ...address, [key]: event.target.value })} />
                  </div>
                ))}
              </div>
              <Button disabled={!query.data || save.isPending} type="submit">Save return address</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
