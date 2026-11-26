import { alterHooks } from "../../../shared/alter";
import { trustRelationshipsHook } from "../../../server/services/trust-relationships";
import { readRelationships } from "./storage/trust-relationships";
export function registerTrustRelationships() {
  alterHooks.register(trustRelationshipsHook, {
    id: "worker.relations.trust", component: "worker.relations", priority: 10,
    description: "Resolve directed relationships and their type labels", metadata: {},
    alter: (_previous, { query }) => readRelationships(query),
  });
}
