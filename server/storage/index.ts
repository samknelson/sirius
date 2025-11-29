export { DatabaseStorage, type IStorage, storage } from "./database";
export { type VariableStorage, createVariableStorage } from "./variables";
export { type UserStorage, createUserStorage } from "./users";
export { type CommStorage, type CommSmsStorage, type CommSmsOptinStorage, type CommEmailStorage, type CommEmailOptinStorage, type CommPostalStorage, type CommPostalOptinStorage, type CommWithSms, type CommWithDetails, type CommWithPostal, type CommSmsWithComm, type CommPostalWithComm, createCommStorage, createCommSmsStorage, createCommSmsOptinStorage, createCommEmailStorage, createCommEmailOptinStorage, createCommPostalStorage, createCommPostalOptinStorage } from "./comm";
