import { ResultsTable as FrameworkResultsTable } from "@/components/wizards/framework/ResultsTable";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { GeneratedExclusions } from "./CoverageEntries";

/** The standard results preview, with what the file left out stated above it. */
export function ResultsTable(props: WizardStepComponentProps) {
  return <div className="space-y-4">
    <GeneratedExclusions wizardId={props.wizardId} coverage={props.data?.reportMeta?.coverage} />
    <FrameworkResultsTable {...props} />
  </div>;
}
