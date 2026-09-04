import { useParams } from "wouter";
import { GenericOptionsPage } from "@/components/shared";
import { OptionsLayout } from "@/components/layouts/OptionsLayout";

/**
 * List tab of an options page — the original screen, unchanged. The type
 * lookup, gating and tab strip live in OptionsLayout.
 */
export default function DynamicOptionsPage() {
  const params = useParams<{ type: string }>();
  const optionsType = params.type || "";

  return (
    <OptionsLayout activeTab="list">
      <GenericOptionsPage optionsType={optionsType} />
    </OptionsLayout>
  );
}
