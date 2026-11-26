import { useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EchpInputsContext } from "../../../../../client/src/lib/echp-inputs";

export default function EchpInputs({ children }: { children: ReactNode }) {
  const { hasPermission } = useAuth();
  const [asOf, setAsOf] = useState("");
  const allowed = hasPermission("admin");
  return <EchpInputsContext.Provider value={allowed && asOf ? { asOf } : {}}>
    {allowed && <div className="space-y-2 max-w-xs mb-6" data-testid="section-asof-override">
      <Label htmlFor="asof-date">Evaluate as of date</Label>
      <Input id="asof-date" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} data-testid="input-asof-date" />
      <p className="text-xs text-muted-foreground">Debug override (admin only). Leave blank to use today.</p>
    </div>}
    {children}
  </EchpInputsContext.Provider>;
}
