import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "system.sftp.client",
  name: "SFTP Client",
  description: "SFTP client for secure file transfers",
  enabledByDefault: false,
  category: "core",
  managesSchema: true,
  schemaManifest: {
    version: 1,
    schemaPath: "./components/system.sftp.client/shared/schema/system/sftp-client-schema.ts",
    tables: ["sftp_client_destinations"],
  },
};
