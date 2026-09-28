import type { ReactNode } from "react";
import { EntityTabNavigation } from "@/components/shared/EntityTabNavigation";
import { useOneoffTabAccess } from "@/hooks/useTabAccess";

interface OneoffLayoutProps {
  activeTab: "oneoff-operations" | "oneoff-instructions";
  children: ReactNode;
}

/** Shared, registry-backed navigation for the two routed Oneoff pages. */
export function OneoffLayout({ activeTab, children }: OneoffLayoutProps) {
  const { tabs } = useOneoffTabAccess();

  return (
    <>
      <EntityTabNavigation
        tabs={tabs}
        activeTab={activeTab}
        testIdPrefix="tab-oneoff-"
        primaryTestId="tabs-oneoff"
      />
      {children}
    </>
  );
}