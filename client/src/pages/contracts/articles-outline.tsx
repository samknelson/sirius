import { useParams } from "wouter";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { ContractOutline } from "@/components/contracts/ContractOutline";

export default function ContractArticlesOutlinePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ContractLayout activeTab="articles-outline">
      {id && <ContractOutline contractId={id} />}
    </ContractLayout>
  );
}
