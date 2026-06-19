---
name: Vite HMR vs app WebSocket conflict
description: Why HMR breaks (preview "not loading") when an app WebSocketServer shares the dev HTTP server, and how to coexist.
---

# Vite HMR breaks when an app WebSocketServer uses `{ server, path }`

In dev, Vite runs in **middlewareMode** and attaches its HMR WebSocket to the
shared Express HTTP server (`server/vite.ts` sets `hmr: { server }`). If any app
WebSocketServer is created with `new WebSocketServer({ server, path: "/ws" })`,
the `ws` library installs an `upgrade` listener that **aborts every
non-matching upgrade with HTTP 400** — including Vite's HMR upgrade on path `/`.
Result: HMR never connects, the page never auto-reloads after a server restart,
and the user perceives this as "preview not loading."

**Why:** the `{ server, path }` form makes `ws` call `handleUpgrade`, which
`abortHandshake(socket, 400)` for any path that isn't its own. It does not let
other listeners (Vite) handle the socket.

**How to apply / fix pattern:** create the app WS with `{ noServer: true }` and
add a manual `server.on("upgrade", ...)` that only `handleUpgrade`s its own path
and `return`s (leaves the socket untouched — do NOT destroy) for everything
else, so Vite HMR keeps working. Lives in `server/services/websocket.ts`.

# Replit + Vite HMR client URL

`server/vite.ts` overrides `vite.config.ts`'s `server` block via its own
`serverOptions`, so HMR settings from the config file are discarded. When
`REPL_ID` is set, the `hmr` block must include `clientPort: 443` and
`protocol: "wss"`, or the client guesses an invalid WS URL
(`ws://localhost:5000`, `wss://localhost:undefined`) which throws an
unhandledrejection the runtime-error overlay can surface as a fake full-screen
error. With `clientPort` truthy, the Vite client also skips its
`directSocketHost` (`localhost:undefined`) fallback entirely.

**Verify:** browser console should show `[vite] connected.` A standalone `ws`
test client may time out even when the browser connects (missing Origin /
handshake parity) — trust the browser console, not the raw client.
