import { Hono } from 'hono';
import { mergeSettings } from '../../shared/rzl';
import type { HistoryDto, SeasonDto, SeasonSummary, TournamentDto } from '../../shared/types';
import { fail, now } from '../lib/http';
import { logDecision, playerLabel } from '../lib/log';
import { discover } from '../lib/importer';
import { getSeason, loadSeason, seasonIssues, standingsView, type TournamentRow } from '../lib/season';
import { seasonPlayersView } from './players';
import type { AppEnv } from '../types';

export const seasons = new Hono<AppEnv>();

export function tournamentDto(t: TournamentRow): TournamentDto {
  return {
    id: t.id,
    roundId: t.round_id,
    tnr: t.tnr,
    grp: t.grp,
    linkName: t.link_name,
    title: t.title,
    crLastUpdate: t.cr_last_update,
    roundsCount: t.rounds_count,
    playerCount: t.player_count,
    status: t.status as TournamentDto['status'],
    error: t.error,
    fetchedAt: t.fetched_at,
    hasRaw: !!t.has_raw,
  };
}

seasons.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.start_year, s.seed_tnr, s.discovered_at,
            (SELECT COUNT(*) FROM tournaments t WHERE t.season_id = s.id) AS n,
            (SELECT COUNT(*) FROM tournaments t WHERE t.season_id = s.id AND t.status = 'fetched') AS f
     FROM seasons s ORDER BY s.start_year DESC, s.id DESC`
  ).all<{ id: number; name: string; start_year: number; seed_tnr: number; discovered_at: number | null; n: number; f: number }>();
  const out: SeasonSummary[] = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    startYear: r.start_year,
    seedTnr: r.seed_tnr,
    discoveredAt: r.discovered_at,
    tournaments: r.n,
    fetched: r.f,
  }));
  return c.json(out);
});

/** Create a season from the seed tournament (first A) and discover linked tournaments right away. */
seasons.post('/', async (c) => {
  const body = await c.req.json<{ seedTnr: number | string; name?: string; startYear?: number }>();
  const tnr = Number(String(body.seedTnr).match(/(\d{5,})/)?.[1]);
  if (!tnr) fail(400, 'Zadejte číslo turnaje nebo odkaz na chess-results');
  const dup = await c.env.DB.prepare('SELECT id FROM seasons WHERE seed_tnr = ?').bind(tnr).first();
  if (dup) fail(409, 'Sezóna s tímto turnajem už existuje');
  // New seasons rank HD8 separately by default (can be switched off in the season settings).
  const res = await c.env.DB.prepare('INSERT INTO seasons (name, start_year, seed_tnr, settings, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(body.name?.trim() ?? '', body.startYear ?? new Date().getFullYear(), tnr, JSON.stringify({ hd8: true }), now())
    .run();
  const id = Number(res.meta.last_row_id);
  const season = await getSeason(c.env.DB, id);
  try {
    await discover(c.env.DB, season);
  } catch (e) {
    await c.env.DB.prepare('DELETE FROM seasons WHERE id = ?').bind(id).run();
    throw e;
  }
  // Start year from the name "2025/26" when not given.
  const s2 = await getSeason(c.env.DB, id);
  const y = Number(s2.name.match(/^(\d{4})/)?.[1]);
  if (!body.startYear && y) await c.env.DB.prepare('UPDATE seasons SET start_year = ? WHERE id = ?').bind(y, id).run();
  if (!s2.name) await c.env.DB.prepare('UPDATE seasons SET name = ? WHERE id = ?').bind(`Sezóna ${tnr}`, id).run();
  return c.json({ id }, 201);
});

seasons.get('/:id', async (c) => {
  const L = await loadSeason(c.env.DB, Number(c.req.param('id')));
  const issues = seasonIssues(L).filter((i) => !i.acked);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const dto: SeasonDto = {
    id: L.season.id,
    name: L.season.name,
    startYear: L.season.start_year,
    seedTnr: L.season.seed_tnr,
    settings: L.settings,
    discoveredAt: (L.season as unknown as { discovered_at: number | null }).discovered_at,
    rounds: L.rounds.map((r) => ({ id: r.id, ordinal: r.ordinal, place: r.place, date: r.date })),
    tournaments: L.tournaments.map(tournamentDto),
    issueCounts: counts,
    instanceCounts: {
      open: [...L.instances.values()].filter((i) => i.player_id == null).length,
      auto: [...L.instances.values()].filter((i) => i.player_id != null && i.status === 'auto').length,
    },
  };
  return c.json(dto);
});

seasons.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const s = await getSeason(c.env.DB, id);
  const body = await c.req.json<{ name?: string; startYear?: number; settings?: unknown }>();
  const settings = body.settings !== undefined ? JSON.stringify(mergeSettings(body.settings)) : s.settings;
  await c.env.DB.prepare('UPDATE seasons SET name = ?, start_year = ?, settings = ? WHERE id = ?')
    .bind(body.name?.trim() || s.name, body.startYear ?? s.start_year, settings, id)
    .run();
  return c.json({ ok: true });
});

seasons.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM seasons WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

seasons.post('/:id/discover', async (c) => {
  const s = await getSeason(c.env.DB, Number(c.req.param('id')));
  return c.json(await discover(c.env.DB, s));
});

seasons.patch('/:id/rounds/:rid', async (c) => {
  const body = await c.req.json<{ place?: string; date?: string | null }>();
  await c.env.DB.prepare('UPDATE rounds SET place = COALESCE(?, place), date = COALESCE(?, date) WHERE id = ? AND season_id = ?')
    .bind(body.place?.trim() || null, body.date ?? null, Number(c.req.param('rid')), Number(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

seasons.get('/:id/standings', async (c) => {
  const L = await loadSeason(c.env.DB, Number(c.req.param('id')));
  return c.json({ rounds: L.rounds.map((r) => ({ id: r.id, ordinal: r.ordinal, place: r.place, date: r.date })), bestN: L.settings.bestN, rows: standingsView(L) });
});

seasons.get('/:id/issues', async (c) => {
  const L = await loadSeason(c.env.DB, Number(c.req.param('id')));
  return c.json(seasonIssues(L));
});

/** History of decisions (newest first); entries without a season (clubs, LOK verdicts) belong to every season. */
seasons.get('/:id/history', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, at, kind, title, detail, player_id, tournament_id, instance_id FROM decision_log
     WHERE season_id = ? OR season_id IS NULL ORDER BY at DESC, id DESC LIMIT 2000`
  )
    .bind(Number(c.req.param('id')))
    .all<{ id: number; at: number; kind: string; title: string; detail: string | null; player_id: number | null; tournament_id: number | null; instance_id: number | null }>();
  return c.json(
    rows.results.map(
      (r): HistoryDto => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, detail: r.detail, playerId: r.player_id, tournamentId: r.tournament_id, instanceId: r.instance_id })
    )
  );
});

seasons.post('/:id/issues/ack', async (c) => {
  const { key, acked, title } = await c.req.json<{ key: string; acked: boolean; title?: string }>();
  const id = Number(c.req.param('id'));
  await logDecision(c.env.DB, { seasonId: id, kind: 'ack', title: `${acked ? 'V pořádku' : 'Vráceno mezi upozornění'}: ${title ?? key}` });
  if (acked) await c.env.DB.prepare('INSERT OR IGNORE INTO issue_acks (season_id, issue_key, created_at) VALUES (?, ?, ?)').bind(id, key, now()).run();
  else await c.env.DB.prepare('DELETE FROM issue_acks WHERE season_id = ? AND issue_key = ?').bind(id, key).run();
  return c.json({ ok: true });
});

/** Confirm / set genders in bulk (e.g. all guesses from names at once). */
seasons.post('/:id/genders', async (c) => {
  const { items } = await c.req.json<{ items: { playerId: number; gender: 'M' | 'F' }[] }>();
  if (!Array.isArray(items) || !items.length) fail(400, 'Nic k uložení');
  const db = c.env.DB;
  await db.batch(items.filter((i) => i.gender === 'M' || i.gender === 'F').map((i) => db.prepare("UPDATE players SET gender = ?, gender_source = 'manual' WHERE id = ?").bind(i.gender, i.playerId)));
  for (const i of items)
    await logDecision(db, { seasonId: Number(c.req.param('id')), kind: 'gender', title: `Pohlaví: ${await playerLabel(db, i.playerId)} – ${i.gender === 'F' ? 'dívka' : 'chlapec'}`, playerId: i.playerId });
  return c.json({ saved: items.length });
});

seasons.get('/:id/players', async (c) => {
  const L = await loadSeason(c.env.DB, Number(c.req.param('id')));
  return c.json(seasonPlayersView(L));
});

seasons.put('/:id/players/:pid', async (c) => {
  const body = await c.req.json<{ postup?: string | null; note?: string | null }>();
  await c.env.DB.prepare(
    `INSERT INTO season_players (season_id, player_id, postup, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(season_id, player_id) DO UPDATE SET postup = excluded.postup, note = excluded.note`
  )
    .bind(Number(c.req.param('id')), Number(c.req.param('pid')), body.postup || null, body.note || null)
    .run();
  return c.json({ ok: true });
});
