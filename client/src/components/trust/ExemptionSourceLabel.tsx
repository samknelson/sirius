import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { TRUST_EXEMPTION_SOURCE_BAO_APPEAL, type TrustBenefitEligibilityExemptionSource } from "@shared/schema";

/** Human label per provenance kind, as staff know the originating record. */
export function exemptionSourceLabel(source: TrustBenefitEligibilityExemptionSource): string {
  switch (source.kind) {
    case TRUST_EXEMPTION_SOURCE_BAO_APPEAL:
      return "Benefit Appeal";
  }
}

/**
 * Where an exemption came from, as a badge plus a link to the originating
 * record. Null provenance renders an em dash: the row was entered by hand and
 * there is nothing to point at. The link is only offered when the component
 * owning the record is on — a row can outlive the feature that created it.
 */
export function ExemptionSourceLabel({
  source,
  exemptionId,
}: {
  source: TrustBenefitEligibilityExemptionSource | null;
  exemptionId: string;
}) {
  const { data: componentConfigs = [] } = useQuery<{ componentId: string; enabled: boolean }[]>({
    queryKey: ["/api/components/config"],
  });
  if (!source) return <span className="text-muted-foreground">—</span>;

  const componentOn = (componentId: string) =>
    componentConfigs.some((c) => c.componentId === componentId && c.enabled);

  switch (source.kind) {
    case TRUST_EXEMPTION_SOURCE_BAO_APPEAL:
      return (
        <div className="flex flex-wrap items-center gap-2" data-testid={`source-exemption-${exemptionId}`}>
          <Badge variant="secondary">{exemptionSourceLabel(source)}</Badge>
          {componentOn("sitespecific.bao") && (
            <Link
              href={`/bao/cases/${source.caseId}`}
              className="text-sm underline underline-offset-4"
              data-testid={`link-exemption-source-case-${exemptionId}`}
            >
              View case
            </Link>
          )}
        </div>
      );
  }
}
