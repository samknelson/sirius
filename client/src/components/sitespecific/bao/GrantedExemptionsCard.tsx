import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { pluginManifestQueryKey } from "@/plugins/_core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrustBenefitEligibilityExemptionView } from "@shared/schema";

function ymd(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/**
 * The eligibility exemption(s) an approved Benefit Appeal granted, each
 * linking to the worker's Exemptions page with that row singled out.
 *
 * Shown when there is something to show, or when the appeal is approved and
 * nothing is on record — an approval with no exemption behind it is worth a
 * sentence, not silence. `null` means the exemptions component is off, in
 * which case nothing is claimed either way.
 */
export function GrantedExemptionsCard({
  exemptions,
  workflowStep,
}: {
  exemptions: TrustBenefitEligibilityExemptionView[] | null | undefined;
  workflowStep: string | null | undefined;
}) {
  const { data: plugins = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: pluginManifestQueryKey("trust-eligibility"),
  });
  const { data: benefits = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/trust-benefits"],
  });
  if (!exemptions) return null;
  if (exemptions.length === 0 && workflowStep !== "approved") return null;

  const pluginName = (id: string) => plugins.find((p) => p.id === id)?.name || id;
  const benefitName = (id: string) => benefits.find((b) => b.id === id)?.name || id;

  return (
    <Card data-testid="card-granted-exemptions">
      <CardHeader>
        <CardTitle>Granted exemption</CardTitle>
        <CardDescription>
          The eligibility exemption this appeal&rsquo;s approval created for the member.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {exemptions.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-no-granted-exemption">
            No exemption is on record for this appeal.
          </p>
        ) : (
          <ul className="space-y-3">
            {exemptions.map((exemption) => (
              <li
                key={exemption.id}
                className="space-y-1 rounded border p-3"
                data-testid={`granted-exemption-${exemption.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{benefitName(exemption.benefitId)}</span>
                  <span className="text-sm text-muted-foreground">
                    from {ymd(exemption.startYmd)}
                    {exemption.endYmd ? ` through ${ymd(exemption.endYmd)}` : ", no end date"}
                  </span>
                </div>
                {exemption.eligibilityPlugins.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="text-muted-foreground">Exempt from</span>
                    {exemption.eligibilityPlugins.map((p) => (
                      <Badge key={p} variant="outline">{pluginName(p)}</Badge>
                    ))}
                  </div>
                )}
                {exemption.description && (
                  <p className="text-sm text-muted-foreground">{exemption.description}</p>
                )}
                <Link
                  href={`/workers/${exemption.subscriberWorkerId}/benefits/exemptions?exemption=${exemption.id}`}
                  className="inline-block text-sm underline underline-offset-4"
                  data-testid={`link-granted-exemption-${exemption.id}`}
                >
                  Open on the member&rsquo;s Exemptions page
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
