import type { InsertEdlsCrew } from "../../shared/schema/edls/schema";

export interface CrewExtensionProps {
  crew: { data?: unknown; id?: string };
  index: number;
  onChange?: (data: InsertEdlsCrew["data"]) => void;
}
