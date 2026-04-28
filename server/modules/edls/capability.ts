import { tableExists } from "../../storage/utils";
import { isComponentEnabled } from "../components";

let cachedTableExists: boolean | null = null;

async function workerEdlsTableExists(): Promise<boolean> {
  if (cachedTableExists !== null) return cachedTableExists;
  try {
    cachedTableExists = await tableExists("worker_edls");
  } catch {
    cachedTableExists = false;
  }
  return cachedTableExists;
}

export async function isWorkerEdlsAvailable(): Promise<boolean> {
  const componentOn = await isComponentEnabled("edls");
  if (!componentOn) return false;
  return workerEdlsTableExists();
}

export function resetWorkerEdlsCapabilityCache() {
  cachedTableExists = null;
}
