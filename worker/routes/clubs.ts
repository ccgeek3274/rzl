import { Hono } from 'hono';
import type { ClubDto } from '../../shared/types';
import { fail } from '../lib/http';
import { logDecision } from '../lib/log';
import type { AppEnv } from '../types';

export const clubs = new Hono<AppEnv>();

clubs.get('/', async (c) => {
  const seasonId = Number(c.req.query('season') || 0);
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.full_name, c.region, c.note,
       (SELECT group_concat(raw, '|') FROM club_aliases a WHERE a.club_id = c.id) AS aliases,
       (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id ${
         seasonId ? 'AND p.id IN (SELECT e.player_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?1)' : ''
       }) AS players
     FROM clubs c ORDER BY c.region IS NOT NULL, c.name`
  )
    .bind(...(seasonId ? [seasonId] : []))
    .all<{ id: number; name: string; full_name: string; region: string | null; note: string | null; aliases: string | null; players: number }>();
  const out: ClubDto[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    region: r.region as ClubDto['region'],
    note: r.note,
    aliases: r.aliases ? r.aliases.split('|') : [],
    players: r.players,
  }));
  return c.json(out);
});

clubs.patch('/:id', async (c) => {
  const b = await c.req.json<{ name?: string; region?: 'in' | 'out' | null; note?: string | null }>();
  const cur = await c.env.DB.prepare('SELECT * FROM clubs WHERE id = ?').bind(Number(c.req.param('id'))).first<{ name: string; region: string | null; note: string | null }>();
  if (!cur) fail(404, 'Oddíl nenalezen');
  await c.env.DB.prepare('UPDATE clubs SET name = ?, region = ?, note = ? WHERE id = ?')
    .bind(b.name?.trim() || cur.name, b.region !== undefined ? b.region : cur.region, b.note !== undefined ? b.note : cur.note, Number(c.req.param('id')))
    .run();
  const ch: string[] = [];
  if (b.region !== undefined && b.region !== cur.region) ch.push(b.region === 'in' ? 'patří do regionu' : b.region === 'out' ? 'mimo region' : 'region nerozhodnut');
  if (b.name?.trim() && b.name.trim() !== cur.name) ch.push(`přejmenován na ${b.name.trim()}`);
  if (b.note !== undefined && b.note !== cur.note) ch.push('poznámka');
  if (ch.length) await logDecision(c.env.DB, { kind: 'club', title: `Oddíl ${cur.name}: ${ch.join(', ')}` });
  return c.json({ ok: true });
});

/** Merge club `sourceId` into `:id` (different spellings of one club). */
clubs.post('/:id/merge', async (c) => {
  const id = Number(c.req.param('id'));
  const { sourceId } = await c.req.json<{ sourceId: number }>();
  if (id === sourceId) fail(400, 'Nelze sloučit oddíl se sebou samým');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE club_aliases SET club_id = ? WHERE club_id = ?').bind(id, sourceId),
    c.env.DB.prepare('UPDATE players SET club_id = ? WHERE club_id = ?').bind(id, sourceId),
    c.env.DB.prepare('DELETE FROM clubs WHERE id = ?').bind(sourceId),
  ]);
  const names = await c.env.DB.prepare('SELECT name FROM clubs WHERE id = ?').bind(id).first<{ name: string }>();
  await logDecision(c.env.DB, { kind: 'club', title: `Oddíly sloučeny do ${names?.name ?? id}` });
  return c.json({ ok: true });
});
