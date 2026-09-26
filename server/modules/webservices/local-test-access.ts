import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const LOCAL_WS_TEST_HEADER = "x-internal-ws-test";
const token = randomBytes(32).toString("hex");
const tokenBytes = Buffer.from(token);

/** Only the server-side admin tester may reach the dispatcher on an api-user-only process. */
export function localWsTestToken(): string {
  return token;
}

export function isLocalWsTestRequest(req: Request): boolean {
  const supplied = req.get(LOCAL_WS_TEST_HEADER);
  return req.socket.remoteAddress === "127.0.0.1"
    && typeof supplied === "string"
    && supplied.length === token.length
    && timingSafeEqual(Buffer.from(supplied), tokenBytes);
}