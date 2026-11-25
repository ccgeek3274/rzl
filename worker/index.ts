import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { seasons } from './routes/seasons';
import { players } from './routes/players';
import { tournaments } from './routes/tournaments';
import { clubs } from './routes/clubs';
import { instances } from './routes/instances';
import type { AppEnv } from './types';

// Only /api/* reaches the Worker (assets.run_worker_first); everything else is the SPA.
// TODO before deploy: port auth from ../vedouci-souteze (Google OAuth + JWT cookie); local version is open.
const app = new Hono<AppEnv>().basePath('/api/v1');

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/seasons', seasons);
app.route('/players', players);
app.route('/clubs', clubs);
app.route('/', tournaments);
app.route('/', instances);

app.notFound((c) => c.json({ error: 'Nenalezeno' }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: `Interní chyba serveru: ${(err as Error).message}` }, 500);
});

export default app;
