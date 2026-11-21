// Vercel serverless entry: every /api/* request lands here.
import { handle } from '../server/routes.js';

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const out = await handle({
    method: req.method,
    path,
    query: Object.fromEntries(url.searchParams),
    body: req.body,
    headers: req.headers,
  });
  res.status(out.status).setHeader('Cache-Control', 'no-store').json(out.json);
}
