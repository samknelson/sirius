import express from "express";
import { createServer } from "http";

const app = express();
const server = createServer(app);

let appReady = false;

app.get('/health', (_req, res) => {
  res.status(200).json({ status: appReady ? 'ready' : 'starting' });
});

app.use('/', (req, res, next) => {
  if (appReady) {
    return next();
  }
  
  if (req.path === '/') {
    const acceptHeader = req.headers.accept || '';
    if (acceptHeader.includes('text/html')) {
      res.status(200).set({ 'Content-Type': 'text/html' }).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Starting...</title>
            <meta http-equiv="refresh" content="2">
            <style>
              body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .loader { text-align: center; color: #666; }
            </style>
          </head>
          <body>
            <div class="loader">
              <p>Application is starting...</p>
              <p><small>This page will refresh automatically.</small></p>
            </div>
          </body>
        </html>
      `);
      return;
    } else {
      res.status(200).json({ status: 'starting' });
      return;
    }
  }
  
  res.status(503).json({ message: 'Application is starting, please wait...' });
});

const port = parseInt(process.env.PORT || '5000', 10);

server.listen({
  port,
  host: "0.0.0.0",
  reusePort: true,
}, async () => {
  console.log(`Server listening on port ${port}, loading application...`);
  
  try {
    const { startApp } = await import('./app-init');
    await startApp(app, server, () => {
      appReady = true;
      console.log(`Application fully initialized and ready`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
});
