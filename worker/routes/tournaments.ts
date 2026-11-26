import { Hono } from 'hono';
import { fail, now } from '../lib/http';
import { crLabel, logDecision, playerLabel } from '../lib/log';
import { fetchTournament, importTournament } from '../lib/importer';
import { assignInstance, dropIfOrphan, newPlayerFromInstance, resolveRuledOut } from '../lib/instances';
import { chessczOf, loadSeason, tournamentView, type PlayerRow } from '../lib/season';
import { cachedClub, cachedMember, getClubMembers, getMember } from '../lib/chesscz';
import { sameRegisteredName } from '../../shared/text';
import type { ChessczInfo } from '../../shared/types';
import { tournamentDto } from './seasons';
import { enrichFromChesscz, enrichInstanceFromCr } from './players';
import type { AppEnv } from '../types';

export const tournaments = new Hono<AppEnv>();

type TRow = { id: number; season_id: number; round_id: number; tnr: number; grp: string; link_name: string; raw_start: string | null; raw_cross: string | null };

async function getT(db: D1Database, id: number): Promise<TRow> {
  const t = await db.prepare('SELECT id, season_id, round_id, tnr, grp, link_name, raw_start, raw_cross FROM tournaments WHERE id = ?').bind(id).first<TRow>();
  if (!t) fail(404, 'Turnaj nenalezen');
  return t;
}

tournaments.get('/tournaments/:id', async (c) => {
  const t = await getT(c.env.DB, Number(c.req.param('id')));
  const L = await loadSeason(c.env.DB, t.season_id);
  const v = tournamentView(L, t.id);
  return c.json({ ...v, tournament: tournamentDto(v.tournament) });
});

/** Download from chess-results (start list + crosstable) and import. */
tournaments.post('/tournaments/:id/fetch', async (c) => {
  const t = await getT(c.env.DB, Number(c.req.param('id')));
  // ?stored=1: use the copy downloaded earlier when there is one (replaying a season without hitting chess-results).
  if (c.req.query('stored') && t.raw_start && t.raw_cross) return c.json(await importTournament(c.env.DB, t, t.raw_start, t.raw_cross));
  return c.json(await fetchTournament(c.env.DB, t));
});

/** Re-import from the stored HTML (after a parser change), no network. */
tournaments.post('/tournaments/:id/reparse', async (c) => {
  const t = await getT(c.env.DB, Number(c.req.param('id')));
  if (!t.raw_start || !t.raw_cross) fail(400, 'Turnaj ještě nebyl stažen');
  return c.json(await importTournament(c.env.DB, t, t.raw_start, t.raw_cross));
});

tournaments.patch('/tournaments/:id', async (c) => {
  const b = await c.req.json<{ grp?: string }>();
  if (b.grp && !/^[A-Z]$/.test(b.grp)) fail(400, 'Skupina musí být jedno písmeno');
  await c.env.DB.prepare('UPDATE tournaments SET grp = COALESCE(?, grp) WHERE id = ?').bind(b.grp ?? null, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/** Corrections of one result row. playerId => assign the row's instance (or with rowOnly just this row). */
tournaments.patch('/entries/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare(
    'SELECT e.id, e.player_id, e.instance_id, e.cr_name, e.tournament_id, t.season_id, t.link_name FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.id = ?'
  )
    .bind(id)
    .first<{ id: number; player_id: number | null; instance_id: number | null; cr_name: string; tournament_id: number; season_id: number; link_name: string }>();
  if (!e) fail(404, 'Výsledek nenalezen');
  const b = await c.req.json<Partial<{ playerId: number; rowOnly: boolean; pointsOverride: number | null; rankOverride: number | null; excluded: boolean; note: string | null }>>();
  const db = c.env.DB;
  if (b.playerId !== undefined) {
    if (b.rowOnly || !e.instance_id) {
      // Exception for this row only (e.g. two different children share one instance).
      await db.prepare("UPDATE entries SET player_id = ?, match = 'manual', updated_at = ? WHERE id = ?").bind(b.playerId, now(), id).run();
      await dropIfOrphan(db, e.player_id);
    } else {
      await db.prepare('UPDATE entries SET match = NULL, updated_at = ? WHERE id = ?').bind(now(), id).run();
      await assignInstance(db, e.instance_id, b.playerId);
    }
  }
  if (b.pointsOverride !== undefined || b.rankOverride !== undefined || b.excluded !== undefined || b.note !== undefined) {
    const cur = await db.prepare('SELECT points_override, rank_override, excluded, note FROM entries WHERE id = ?').bind(id).first<{ points_override: number | null; rank_override: number | null; excluded: number; note: string | null }>();
    await db
      .prepare('UPDATE entries SET points_override = ?, rank_override = ?, excluded = ?, note = ?, updated_at = ? WHERE id = ?')
      .bind(
        b.pointsOverride !== undefined ? b.pointsOverride : cur!.points_override,
        b.rankOverride !== undefined ? b.rankOverride : cur!.rank_override,
        b.excluded !== undefined ? (b.excluded ? 1 : 0) : cur!.excluded,
        b.note !== undefined ? b.note : cur!.note,
        now(),
        id
      )
      .run();
    const ch: string[] = [];
    if (b.excluded !== undefined && !!b.excluded !== !!cur!.excluded) ch.push(b.excluded ? 'nezapočítává se' : 'znovu se započítává');
    if (b.pointsOverride !== undefined && b.pointsOverride !== cur!.points_override) ch.push(b.pointsOverride == null ? 'zrušena oprava bodů' : `body opraveny na ${b.pointsOverride}`);
    if (b.rankOverride !== undefined && b.rankOverride !== cur!.rank_override) ch.push(b.rankOverride == null ? 'zrušena oprava pořadí' : `pořadí opraveno na ${b.rankOverride}.`);
    if (b.note !== undefined && b.note !== cur!.note && b.note) ch.push(`poznámka: ${b.note}`);
    if (ch.length)
      await logDecision(db, { seasonId: e.season_id, kind: 'entry', title: `${crLabel(e.cr_name)} (${e.link_name}): ${ch.join(', ')}`, playerId: e.player_id, tournamentId: e.tournament_id });
  }
  if (b.playerId !== undefined)
    await logDecision(db, {
      seasonId: e.season_id,
      kind: 'pairing',
      title: `${b.rowOnly || !e.instance_id ? 'Řádek' : 'Párování'}: ${crLabel(e.cr_name)} (${e.link_name}) → ${await playerLabel(db, b.playerId)}`,
      playerId: b.playerId,
      tournamentId: e.tournament_id,
      instanceId: e.instance_id,
    });
  return c.json({ ok: true });
});

/** The row's instance is a different person than the matched player: create a new player from it. */
tournaments.post('/entries/:id/new-player', async (c) => {
  const e = await c.env.DB.prepare('SELECT instance_id FROM entries WHERE id = ?').bind(Number(c.req.param('id'))).first<{ instance_id: number | null }>();
  if (!e) fail(404, 'Výsledek nenalezen');
  if (!e.instance_id) fail(400, 'Řádek nemá instanci – načtěte turnaj znovu');
  const i = await c.env.DB.prepare('SELECT cr_name FROM player_instances WHERE id = ?').bind(e.instance_id).first<{ cr_name: string }>();
  const playerId = await newPlayerFromInstance(c.env.DB, e.instance_id);
  const t = await c.env.DB.prepare('SELECT t.season_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.id = ?').bind(Number(c.req.param('id'))).first<{ season_id: number }>();
  await logDecision(c.env.DB, {
    seasonId: t?.season_id,
    kind: 'pairing',
    title: `Párování: ${crLabel(i?.cr_name ?? '')} → nový hráč ${await playerLabel(c.env.DB, playerId)}`,
    playerId,
    instanceId: e.instance_id,
  });
  return c.json({ playerId });
});

/**
 * Batch enrichment of a season's players (client calls repeatedly until remaining = 0):
 * registered -> chess.cz (birth year, gender, name, LOK Elo); unregistered without birth year -> chess-results player card.
 */
tournaments.post('/seasons/:id/enrich', async (c) => {
  const seasonId = Number(c.req.param('id'));
  const { limit = 8 } = await c.req.json<{ limit?: number }>().catch(() => ({ limit: 8 }));
  const db = c.env.DB;
  await resolveRuledOut(db, seasonId);
  const inSeason = `p.id IN (SELECT e.player_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?1)`;
  // Registered players not yet read from chess.cz.
  const czSql = `SELECT p.*, NULL AS club_name, NULL AS club_region FROM players p WHERE ${inSeason} AND p.lok_id IS NOT NULL AND p.chesscz_at IS NULL`;
  // Instances (of the season) of players without LOK, or whose LOK differs from the tournament's: birth year from the player card.
  const cardSql = `SELECT i.id, i.player_id FROM player_instances i LEFT JOIN players p ON p.id = i.player_id
     WHERE i.birth_checked = 0 AND (p.id IS NULL OR p.lok_id IS NULL OR i.lok_id IS NULL OR p.lok_id != i.lok_id)
       AND i.id IN (SELECT e.instance_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?1)`;
  const errors: string[] = [];
  let processed = 0;
  const started = Date.now();
  const cz = await db.prepare(`${czSql} LIMIT ?2`).bind(seasonId, limit).all<PlayerRow>();
  for (const p of cz.results) {
    if (Date.now() - started > 20_000) break;
    try {
      if ((await enrichFromChesscz(db, p)) === 'unavailable') {
        errors.push('chess.cz není dostupné');
        break;
      }
      processed++;
    } catch (e) {
      errors.push(`${p.surname} ${p.first_name}: ${(e as Error).message}`);
      break;
    }
  }
  if (!errors.length && processed < limit) {
    const cards = await db.prepare(`${cardSql} LIMIT ?2`).bind(seasonId, limit - processed).all<{ id: number; player_id: number | null }>();
    for (const i of cards.results) {
      if (Date.now() - started > 20_000) break;
      try {
        await enrichInstanceFromCr(db, i.id);
        processed++;
      } catch (e) {
        errors.push(`instance ${i.id}: ${(e as Error).message}`);
        break;
      }
    }
  }
  // Birth years from the cards may rule out candidates (siblings).
  if (processed) await resolveRuledOut(db, seasonId);
  // Open instances with a LOK: its chess.cz record, and for a name conflict the club's member list (evidence for the verdict).
  if (!errors.length && processed < limit) {
    for (const t of (await openLokTasks(db, seasonId)).slice(0, limit - processed)) {
      if (Date.now() - started > 20_000) break;
      const ok = t.kind === 'member' ? (await getMember(db, t.lok)).status !== 'unavailable' : (await getClubMembers(db, t.code)) !== null;
      if (!ok) {
        errors.push('chess.cz není dostupné');
        break;
      }
      processed++;
    }
  }
  const remaining =
    ((await db.prepare(`SELECT COUNT(*) AS n FROM (${czSql})`).bind(seasonId).first<{ n: number }>())?.n ?? 0) +
    ((await db.prepare(`SELECT COUNT(*) AS n FROM (${cardSql})`).bind(seasonId).first<{ n: number }>())?.n ?? 0) +
    (errors.length ? 0 : (await openLokTasks(db, seasonId)).length);
  return c.json({ processed, remaining, errors });
});

/** chess.cz requests still needed for the open instances with a LOK (no verdict yet) of a season. */
async function openLokTasks(db: D1Database, seasonId: number): Promise<({ kind: 'member'; lok: number } | { kind: 'club'; code: string })[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT i.lok_id, i.cr_name FROM player_instances i
       WHERE i.status = 'open' AND i.lok_id IS NOT NULL AND i.lok_id NOT IN (SELECT lok_id FROM lok_verdicts)
         AND i.id IN (SELECT e.instance_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?)`
    )
    .bind(seasonId)
    .all<{ lok_id: number; cr_name: string }>();
  const out: ({ kind: 'member'; lok: number } | { kind: 'club'; code: string })[] = [];
  for (const r of rows.results) {
    const cached = await db.prepare('SELECT payload FROM chesscz_cache WHERE cache_key = ?').bind(`/members/${r.lok_id}/cze`).first<{ payload: string }>();
    if (!cached) {
      out.push({ kind: 'member', lok: r.lok_id });
      continue;
    }
    const m = await cachedMember(db, r.lok_id);
    if (m?.clubId && !sameRegisteredName(m.fullName, r.cr_name) && !(await cachedClub(db, m.clubId)) && !out.some((t) => t.kind === 'club' && t.code === m.clubId))
      out.push({ kind: 'club', code: m.clubId });
  }
  return out;
}

/**
 * "Aktualizovat Ela": fresh Elo (ČR + FIDE) for all registered players of the season.
 * Club by club (one chess.cz request per club gives all its members); players not found in their club's list
 * (transfer, no club code yet) are then read one by one from the member detail.
 * The first call fixes `since` (server time); the client passes back `since` and `clubsDone` until remaining = 0.
 */
tournaments.post('/seasons/:id/refresh-elo', async (c) => {
  const seasonId = Number(c.req.param('id'));
  const body = await c.req.json<{ since?: number; clubsDone?: string[]; limit?: number }>().catch(() => ({}) as { since?: number; clubsDone?: string[]; limit?: number });
  const since = body.since ?? Date.now();
  const clubsDone = new Set(body.clubsDone ?? []);
  const limit = body.limit ?? 10;
  const db = c.env.DB;
  const pendingSql = `SELECT p.*, NULL AS club_name, NULL AS club_region FROM players p
     WHERE p.id IN (SELECT e.player_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?1)
       AND p.lok_id IS NOT NULL AND (p.chesscz_at IS NULL OR p.chesscz_at < ?2) ORDER BY p.id`;
  const pending = (await db.prepare(pendingSql).bind(seasonId, since).all<PlayerRow>()).results;
  const errors: string[] = [];
  let processed = 0;
  let club: string | null = null;

  // Next club of a pending player that has not been read in this run.
  const clubOf = (p: PlayerRow) => (chessczOf(p)?.clubId ?? null) as string | null;
  const next = pending.map(clubOf).find((k) => k && !clubsDone.has(k)) ?? null;
  if (next) {
    club = next;
    clubsDone.add(next);
    const members = await getClubMembers(db, next);
    if (!members) errors.push('chess.cz není dostupné');
    else {
      const byLok = new Map(members.map((m) => [m.czeId, m]));
      const stmts: D1PreparedStatement[] = [];
      for (const p of pending) {
        const m = byLok.get(p.lok_id!);
        const cz = chessczOf(p);
        if (!m || !cz) continue;
        const upd: ChessczInfo = {
          ...cz,
          registration: m.registration,
          czeStdElo: m.czeStdElo || 0,
          czeRapidElo: m.czeRapidElo || 0,
          fideId: m.fideId || 0,
          fideStdElo: m.fideStdElo || 0,
          fideRapidElo: m.fideRapidElo || 0,
          fideBlitzElo: m.fideBlitzElo || 0,
        };
        stmts.push(db.prepare('UPDATE players SET chesscz = ?, chesscz_at = ? WHERE id = ?').bind(JSON.stringify(upd), Date.now(), p.id));
      }
      if (stmts.length) await db.batch(stmts);
      processed = stmts.length;
    }
  } else {
    // All clubs done: the rest one by one (also fills the club code for next time).
    const started = Date.now();
    for (const p of pending.slice(0, limit)) {
      if (Date.now() - started > 20_000) break;
      try {
        if ((await enrichFromChesscz(db, p, true)) === 'unavailable') {
          errors.push('chess.cz není dostupné');
          break;
        }
        processed++;
      } catch (e) {
        errors.push(`${p.surname} ${p.first_name}: ${(e as Error).message}`);
        break;
      }
    }
  }
  const remaining = (await db.prepare(`SELECT COUNT(*) AS n FROM (${pendingSql})`).bind(seasonId, since).first<{ n: number }>())?.n ?? 0;
  return c.json({ processed, remaining, errors, since, clubsDone: [...clubsDone], club });
});
