import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Serves /api/* during `npm run dev` using the same handler Vercel runs in production.
function apiDevServer(): Plugin {
  return {
    name: 'mahaveer-api-dev',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));
      // While the app is running on this computer, check once a minute whether the daily email is due.
      // (Once deployed, an outside timer calls /api/cron/daily-email instead.)
      const timer = setInterval(async () => {
        try {
          const mailer = await server.ssrLoadModule('/server/mailer.ts');
          const result = await mailer.runScheduledEmail();
          if (result.sent) console.log('[email] daily report sent');
          else if (result.reason && !/switched off|not time yet|already sent|handling it|not set up/.test(result.reason)) {
            console.warn('[email] daily report not sent:', result.reason);
          }
        } catch (e) {
          console.warn('[email] check failed:', e instanceof Error ? e.message : e);
        }
      }, 60_000);
      server.httpServer?.on('close', () => clearInterval(timer));

      server.middlewares.use('/api', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString();
        const send = (status: number, json: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(json));
        };
        let body: unknown = undefined;
        try { body = raw ? JSON.parse(raw) : undefined; } catch { return send(400, { error: 'The request body is not valid JSON' }); }

        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const { handle } = await server.ssrLoadModule('/server/routes.ts');
          const out = await handle({
            method: req.method ?? 'GET',
            path: url.pathname.split('/').filter(Boolean),
            query: Object.fromEntries(url.searchParams),
            body,
            headers: req.headers,
          });
          send(out.status, out.json);
        } catch (e) {
          // e.g. a syntax error in a server file while editing: say so instead of leaving the request hanging.
          console.error('[api] failed to run the handler:', e);
          send(500, { error: 'The server code could not be loaded. Check the terminal for the error.' });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // lucide-react is deliberately NOT excluded from pre-bundling. Excluded, the dev server hands the browser each
  // icon as its own file (the package has thousands), which made the first load take minutes.
  optimizeDeps: {
    include: ['lucide-react', 'react', 'react-dom', 'chart.js'],
  },
});
