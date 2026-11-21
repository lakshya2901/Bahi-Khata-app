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
        let body: unknown = undefined;
        try { body = raw ? JSON.parse(raw) : undefined; } catch { /* handled as empty body */ }

        const url = new URL(req.url ?? '/', 'http://localhost');
        const { handle } = await server.ssrLoadModule('/server/routes.ts');
        const out = await handle({
          method: req.method ?? 'GET',
          path: url.pathname.split('/').filter(Boolean),
          query: Object.fromEntries(url.searchParams),
          body,
          headers: req.headers,
        });
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(out.json));
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
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
