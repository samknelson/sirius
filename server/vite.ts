import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";
import { nanoid } from "nanoid";

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
    hmr: { server },
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

  // `index: false` is critical. By default express.static serves index.html
  // for `GET /` (and any directory) through the `send` library — the exact racy
  // async-fs path described below. The login screen IS `/`, so with the default
  // index option the shell is served by express.static and NEVER reaches the
  // synchronous buffer handler further down, which is why the white "Internal
  // Server Error" persisted even after the catch-all stopped using sendFile.
  // Turning off the automatic index makes every HTML-shell request fall through
  // to the safe synchronous handler below; express.static now only serves real,
  // named asset files (JS/CSS/images).
  app.use(express.static(distPath, { index: false }));

  // Preload the SPA shell ONCE at boot so the catch-all can serve it with a
  // synchronous res.send(buffer) instead of res.sendFile.
  //
  // Why this matters (the white "Internal Server Error" on the login screen):
  // res.sendFile() / express.static stream the file via the `send` library,
  // which sets the response headers (Content-Type, ETag, ...) from INSIDE an
  // async fs.stat callback. On an authenticated request the session/auth layer
  // flushes an async Set-Cookie; if those headers land first, send's later
  // setHeader call throws ERR_HTTP_HEADERS_SENT *synchronously inside the native
  // fs callback*. That throw cannot be caught by the Express error handler or by
  // sendFile's own error callback, so Express renders it as a plain white
  // "Internal Server Error" page. Serving a preloaded buffer sets all headers
  // synchronously in one tick (guarded by headersSent), leaving no async fs
  // window for the Set-Cookie to race into — it removes the crash at its source.
  const indexHtml = path.resolve(distPath, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(
      `Could not find ${indexHtml}, make sure to build the client first`,
    );
  }
  const indexHtmlBuffer = fs.readFileSync(indexHtml);

  app.use("*", (_req, res) => {
    if (res.headersSent) {
      return;
    }
    res.type("html").send(indexHtmlBuffer);
  });
}
