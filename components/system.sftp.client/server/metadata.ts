import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { sftpClientDestinations } from "../shared/schema/system/sftp-client-schema";
export const metadataContexts: Record<string, MetadataRecordContext> = {
  sftp_client_destinations: {
    table: sftpClientDestinations,
    label: "SFTP Client Destinations",
    hrefTemplate: "/config/sftp/client/{id}",
    component: "system.sftp.client",
    recordGo: { kind: "policy", id: "admin", componentId: "system.sftp.client" },
  },
};
