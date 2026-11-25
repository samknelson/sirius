import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { jobTypeBullpenEnum } from "../shared/types";
export function validateBullpen(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if ("bullpen" in d && (typeof d.bullpen !== "string" || !(jobTypeBullpenEnum as readonly string[]).includes(d.bullpen))) {
    return `bullpen must be one of: ${jobTypeBullpenEnum.join(", ")}`;
  }
  if (d.bullpen === "host" || d.bullpen === "shared") {
    if (typeof d.bullpenEventTypeId !== "string" || d.bullpenEventTypeId.trim() === "") {
      return "An event type is required when Bullpen is set to host or shared";
    }
  } else {
    delete d.bullpenEventTypeId;
  }
  return null;
}
registerOptionsContribution({ id: "dispatch.bullpen.settings", type: "dispatch-job-type", validate: validateBullpen });
