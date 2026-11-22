// Vercel serverless entry: every /api/* request lands here (vercel.json rewrites /api/x/y to /api?__path=x/y).
import { handle } from '../server/routes.js';

export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  // The rewrite passes the original path in __path; fall back to the URL's own path if it is called directly.
  const rewritten = url.searchParams.get('__path');
  url.searchParams.delete('__path');
  const path = (rewritten ?? url.pathname.replace(/^\/api\/?/, '')).split('/').filter(Boolean);
  const out = await handle({
    method: req.method,
    path,
    query: Object.fromEntries(url.searchParams),
    body: req.body,
    headers: req.headers,
  });
  res.status(out.status).setHeader('Cache-Control', 'no-store').json(out.json);
}
