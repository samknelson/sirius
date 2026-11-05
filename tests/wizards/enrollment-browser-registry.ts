// Browser fixture resolves only the shipped components under test, avoiding
// loading every unrelated wizard plugin into the isolated test page.
import { BenefitsStep } from "@/components/wizards/framework/enrollment/BenefitsStep";
import { SignatureStep } from "@/components/wizards/framework/enrollment/SignatureStep";

export const wizardComponentRegistry = {
  resolve(name: string) {
    if (name.endsWith(":BenefitsStep")) return BenefitsStep;
    if (name.endsWith(":SignatureStep")) return SignatureStep;
    // Navigation targets outside the changed steps are intentionally inert:
    // no dependent editing or final posting occurs in this browser fixture.
    return () => "Unchanged enrollment step";
  },
};
