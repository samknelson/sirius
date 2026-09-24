import { EligibilityFailure } from "@/lib/queryClient";

/**
 * Renders the list of failing eligibility criteria returned by a dispatch
 * create/accept 403 rejection: each failing plugin's name and explanation.
 * Usable inside a toast description or an inline alert.
 */
export function EligibilityFailureList({
  failures,
  intro,
}: {
  failures: EligibilityFailure[];
  intro?: string;
}) {
  if (failures.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="list-eligibility-failures">
      {intro && <p>{intro}</p>}
      <ul className="list-disc pl-4 space-y-0.5">
        {failures.map((f, i) => (
          <li key={i} data-testid={`text-eligibility-failure-${i}`}>
            <span className="font-medium">{f.pluginName}:</span> {f.explanation}
          </li>
        ))}
      </ul>
    </div>
  );
}
