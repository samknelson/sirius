import { registerEntityLoader } from '../access-policy-evaluator';

export function wireCommViewAccess(): void {
  registerEntityLoader('comm', async (id, storage) => (await storage.comm.getComm(id)) ?? null);
}
