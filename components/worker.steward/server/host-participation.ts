import { alterHooks } from "../../../shared/alter";
import { organizingStewardsHook } from "../../../server/storage/cardchecks";
import { participantWorkerFactsHook } from "../../../server/services/participant-worker-facts";
import { storage } from "../../../server/storage/database";
import { getOrganizingStewards } from "./storage/organizing-stewards";
export function registerStewardHostParticipation() {
  alterHooks.register(organizingStewardsHook, {
    id: "worker.steward.organizing", component: "worker.steward", priority: 10,
    description: "Supply steward contacts for organizing reports",
    metadata: {},
    alter: () => getOrganizingStewards(),
  });
  alterHooks.register(participantWorkerFactsHook, {
    id: "worker.steward.participant", component: "worker.steward", priority: 10,
    description: "Classify a worker's steward participation", metadata: {},
    async alter(value, { workerId }) {
      return { ...value, isSteward: await storage.workerStewardAssignments.isWorkerSteward(workerId) };
    },
  });
}
