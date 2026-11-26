import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createSftpClientDestinationStorage, sftpClientDestinationLoggingConfig, type SftpClientDestinationStorage } from "./storage/sftp-client-destinations";
export function createStorage(): { sftpClientDestinations: SftpClientDestinationStorage } {
  return { sftpClientDestinations: withStorageLogging(createSftpClientDestinationStorage(), sftpClientDestinationLoggingConfig) };
}
