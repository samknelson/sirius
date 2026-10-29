import assert from "node:assert/strict";
import { Socket } from "node:net";
import twilio from "twilio";
import { WcTwilioHttpClient } from "../../../server/services/webclient/twilio-http";

// Native Node only: the parent bundles local code as ESM, leaving SDK packages
// external just like production. A loader-transformed SDK masks this bug.
Socket.prototype.connect = () => { throw new Error("Real sockets forbidden in this regression"); };
const sid = "AC00000000000000000000000000000000";
let status = 200;
let body = '{"accounts":[{"sid":"' + sid + '","status":"active"}],"next_page_uri":null}';
const calls: { url: URL; init: RequestInit }[] = [];
const adapter = new WcTwilioHttpClient({
  async fetch(input, init = {}) {
    calls.push({ url: new URL(input), init });
    return new Response(body, { status, headers: { "x-sdk-fixture": "present" } });
  },
});
const sdk = twilio(sid, "fake-token-not-a-credential", { httpClient: adapter });

// The exact SDK call used by service.test-connection, without provider traffic.
const accounts = await sdk.api.accounts.list({ limit: 1 });
assert.equal(accounts[0].sid, sid);
assert.equal(accounts[0].status, "active");
assert.equal(adapter.lastResponse?.statusCode, 200);
assert.equal(adapter.lastResponse?.headers["x-sdk-fixture"], "present");
assert.equal(adapter.lastResponse?.toString(), "HTTP 200 [object Object]");
assert.equal(calls[0].url.searchParams.get("PageSize"), "1");

status = 201;
body = '{"sid":"SMfake","status":"queued"}';
const message = await sdk.messages.create({ from: "+15005550006", to: "+15005550009", body: "Fake & offline" });
assert.equal(message.sid, "SMfake");
assert.equal(message.status, "queued");
assert.equal(adapter.lastResponse?.statusCode, 201);
const send = calls[1].init;
assert.equal(new Headers(send.headers).get("authorization"),
  `Basic ${Buffer.from(`${sid}:fake-token-not-a-credential`).toString("base64")}`);
assert.equal(new URLSearchParams(String(send.body)).get("Body"), "Fake & offline");

status = 400;
body = '{"code":21211,"message":"fixture failure","more_info":"https://example.com/error","status":400}';
await assert.rejects(sdk.messages.create({ from: "+15005550006", to: "invalid", body: "offline" }),
  (error: any) => error.status === 400 && error.code === 21211 && error.message === "fixture failure");
assert.equal(adapter.lastResponse?.statusCode, 400);
assert.equal(adapter.lastResponse?.headers["x-sdk-fixture"], "present");

status = 200;
body = "plain text response";
const text = await adapter.request({
  method: "post", uri: "https://api.twilio.com/fixture", params: { tag: ["a", "b"] },
  headers: { "content-type": "application/json" }, data: { offline: true },
});
assert.equal(text.body, body);
assert.equal(text.toString(), "HTTP 200 plain text response");
assert.equal(adapter.lastResponse, text);
assert.deepEqual(calls[3].url.searchParams.getAll("tag"), ["a", "b"]);
assert.equal(calls[3].init.body, '{"offline":true}');
assert.equal(calls.length, 4);
console.log("Native ESM Twilio connection, send, error and diagnostic contracts passed (fake HTTP only)");
