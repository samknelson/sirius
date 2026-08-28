import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { nanoid } from "nanoid";
import { getPlatformEnvironmentVariable } from "./config/env-registry";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // vite and its config are imported lazily so that this module can be loaded
  // in production (where only `serveStatic` is used) without pulling in the
  // `vite` package or `../vite.config` — both of which are dev-only and are
  // NOT installed in the production container. A top-level `import ... from
  // "vite"` here made `dist/app-init.js` (which imports `serveStatic`) fail
  // at load time with ERR_MODULE_NOT_FOUND when devDependencies are absent.
  const { createServer: createViteServer, createLogger } = await import("vite");
  const viteConfig = (await import("../vite.config")).default;
  const viteLogger = createLogger();

  const serverOptions = {
    middlewareMode: true,
    // Attach HMR to the existing HTTP server. On Replit the preview is a
    // proxied iframe served over HTTPS on port 443, so the HMR client must be
    // told to connect via wss on 443 (using the page's own hostname). Without
    // this, Vite falls back to guessing and produces an invalid WebSocket URL
    // (e.g. ws://localhost:5000 / wss://localhost:undefined). That failed
    // connection throws an unhandledrejection which the runtime-error overlay
    // catches and renders as a full-screen modal, making the preview look
    // broken even though the app itself is fine.
    hmr: {
      server,
      ...(getPlatformEnvironmentVariable("REPL_ID")
        ? { clientPort: 443, protocol: "wss" as const }
        : {}),
    },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        if (msg.includes("Cannot set headers after they are sent")) {
          viteLogger.warn(msg, options);
          return;
        }
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  const indexHtml = path.resolve(distPath, "index.html");
  app.use("*", (req, res) => {
    // An async Set-Cookie (session persistence on an authenticated request)
    // can flush the response headers while res.sendFile() is still doing its
    // async fs.stat. When send() then goes to write headers it throws
    // ERR_HTTP_HEADERS_SENT from inside its own stream — bypassing the Express
    // error handler and surfacing to the user as a white "Internal Server
    // Error" page. Guard before sending, and pass a callback so any streaming
    // error is handled cleanly instead of crashing the response.
    if (res.headersSent) {
      return;
    }
    res.sendFile(indexHtml, (err) => {
      if (!err) return;
      const code = (err as NodeJS.ErrnoException & { status?: number }).code;
      log(
        `index.html send failed: ${req.method} ${req.originalUrl} headersSent=${res.headersSent} code=${code ?? "unknown"}`,
        "static",
      );
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          // socket already torn down — nothing more to do
        }
      } else {
        res.status((err as NodeJS.ErrnoException & { status?: number }).status ?? 500).end();
      }
    });
  });
}
