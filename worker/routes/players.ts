import { Hono } from 'hono';
import { parsePlayerInfo } from '../../shared/chessresults';
import { categoryOf } from '../../shared/rzl';
import type { PlayerDetailDto, PlayerGameDto, SeasonPlayerDto, ChessczInfo } from '../../shared/types';
import type { CrGame } from '../../shared/chessresults';
import { fold, guessGender, nameKey } from '../../shared/text';
import { getMember } from '../lib/chesscz';
import { fetchPage } from '../lib/chessresults';
import { fail } from '../lib/http';
import { chessczOf, eligibility, loadSeason, playerName, playersElo, seasonIssues, type LoadedSeason, type PlayerRow } from '../lib/season';
import { mergeSettings } from '../../shared/rzl';
import { lokVerdict, moveInstances, reopenOnLokConflict, type InstanceRow } from '../lib/instances';
import { logDecision, playerLabel, seasonOfPlayer } from '../lib/log';
const rzlLabel = (id: number) => `R${String(id).padStart(4, '0')}`;
import type { AppEnv } from '../types';

export const players = new Hono<AppEnv>();

export function playerDto(p: PlayerRow, extra: { startYear: number; hd8?: boolean; tournaments: number; rzlElo: number | null; postup: string | null; issues: number; otherNames?: string[] }): SeasonPlayerDto {
  return {
    id: p.id,
    otherNames: extra.otherNames ?? [],
    lokId: p.lok_id,
    surname: p.surname,
    firstName: p.first_name,
    name: playerName(p),
    gender: p.gender,
    genderSource: p.gender_source,
    birthYear: p.birth_year,
    birthSource: p.birth_source,
    category: categoryOf(p.birth_year, extra.startYear, extra.hd8),
    clubId: p.club_id,
    club: p.club_name,
    clubLocked: !!p.club_locked,
    regionOverride: p.region_override as SeasonPlayerDto['regionOverride'],
    eligibility: eligibility(p),
    tournaments: extra.tournaments,
    rzlElo: extra.rzlElo,
    chesscz: chessczOf(p),
    chessczAt: p.chesscz_at,
    postup: extra.postup,
    note: p.note,
    issues: extra.issues,
  };
}

export function seasonPlayersView(L: LoadedSeason): SeasonPlayerDto[] {
  const count = new Map<number, number>();
  for (const e of L.entries) if (e.player_id != null && !e.excluded) count.set(e.player_id, (count.get(e.player_id) ?? 0) + 1);
  const issues = new Map<number, number>();
  for (const i of seasonIssues(L)) {
    if (i.acked) continue;
    for (const pid of [i.refs.playerId, ...(i.refs.playerIds ?? [])]) if (pid) issues.set(pid, (issues.get(pid) ?? 0) + 1);
  }
  return [...L.players.values()]
    .map((p) => {
      const steps = L.elo.get(p.id);
      return playerDto(p, {
        startYear: L.season.start_year,
        hd8: L.settings.hd8,
        tournaments: count.get(p.id) ?? 0,
        rzlElo: steps?.length ? steps[steps.length - 1].after : null,
        postup: L.postup.get(p.id)?.postup ?? null,
        issues: issues.get(p.id) ?? 0,
        otherNames: L.otherNames.get(p.id) ?? [],
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

async function getPlayer(db: D1Database, id: number): Promise<PlayerRow> {
  const p = await db
    .prepare('SELECT p.*, c.name AS club_name, c.region AS club_region FROM players p LEFT JOIN clubs c ON c.id = p.club_id WHERE p.id = ?')
    .bind(id)
    .first<PlayerRow>();
  if (!p) fail(404, 'Hráč nenalezen');
  return p;
}

players.get('/search', async (c) => {
  const q = nameKey(c.req.query('q') ?? '', '');
  const lok = Number(c.req.query('q'));
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.surname, p.first_name, p.lok_id, p.birth_year, c.name AS club,
       (SELECT group_concat(DISTINCT replace(i.cr_name, ',', '')) FROM player_instances i WHERE i.player_id = p.id AND i.name_key != p.name_key) AS other
     FROM players p LEFT JOIN clubs c ON c.id = p.club_id
     WHERE p.name_key LIKE ?1 OR p.lok_id = ?2 OR p.id IN (SELECT player_id FROM player_instances WHERE name_key LIKE ?1)
     ORDER BY p.surname, p.first_name LIMIT 30`
  )
    .bind(`%${q}%`, lok || -1)
    .all<{ id: number; surname: string; first_name: string; lok_id: number | null; birth_year: number | null; club: string | null; other: string | null }>();
  return c.json(
    rows.results.map((r) => ({ id: r.id, name: `${r.surname} ${r.first_name}`, otherNames: r.other ? r.other.split(',').map((x) => x.replace(/\s+/g, ' ').trim()) : [], lokId: r.lok_id, birthYear: r.birth_year, club: r.club }))
  );
});

players.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const seasonId = Number(c.req.query('season') || 0);
  const p = await getPlayer(c.env.DB, id);
  const season = seasonId ? await c.env.DB.prepare('SELECT start_year, settings FROM seasons WHERE id = ?').bind(seasonId).first<{ start_year: number; settings: string }>() : null;
  const settings = mergeSettings(JSON.parse(season?.settings ?? '{}'));
  const elo = (await playersElo(c.env.DB, settings, [id])).get(id) ?? [];
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.tournament_id, e.cr_name, e.cr_lok_id, e.club_raw, e.rtg, e.points, e.rank, e.points_override, e.rank_override, e.match, e.excluded, e.instance_id, e.games,
            t.link_name, t.grp, r.date, s.id AS season_id, s.name AS season_name
     FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id JOIN seasons s ON s.id = t.season_id
     WHERE e.player_id = ? ORDER BY r.date, r.ordinal`
  )
    .bind(id)
    .all<{ id: number; tournament_id: number; cr_name: string; cr_lok_id: number | null; club_raw: string; rtg: number | null; points: number; rank: number; points_override: number | null; rank_override: number | null; match: string | null; excluded: number; instance_id: number | null; games: string; link_name: string; grp: string; date: string | null; season_id: number; season_name: string }>();
  const insts = await c.env.DB.prepare(
    `SELECT i.*, (SELECT COUNT(*) FROM entries e WHERE e.instance_id = i.id) AS n,
       (SELECT MIN(r.date) FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = i.id) AS first_date,
       (SELECT MAX(r.date) FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = i.id) AS last_date
     FROM player_instances i WHERE i.player_id = ? ORDER BY first_date, i.id`
  )
    .bind(id)
    .all<InstanceRow & { n: number; first_date: string | null; last_date: string | null }>();
  // RŽL points of each row (from the season's standings) and the games with opponent names.
  const rzl = new Map<number, { points: number; placement: number; counted: boolean }>();
  for (const sid of new Set(rows.results.map((r) => r.season_id))) {
    const L = await loadSeason(c.env.DB, sid);
    const st = L.standings.find((x) => x.playerId === id);
    for (const x of Object.values(st?.results ?? {})) rzl.set(x.entryId, { points: x.points, placement: x.placement, counted: x.counted });
  }
  const tids = [...new Set(rows.results.map((r) => r.tournament_id))];
  const opps = tids.length
    ? (
        await c.env.DB.prepare(`SELECT tournament_id, snr, cr_name, rtg, player_id FROM entries WHERE tournament_id IN (${tids.map(() => '?').join(',')})`)
          .bind(...tids)
          .all<{ tournament_id: number; snr: number; cr_name: string; rtg: number | null; player_id: number | null }>()
      ).results
    : [];
  const oppOf = new Map(opps.map((o) => [`${o.tournament_id}:${o.snr}`, o]));
  const gamesOf = (tid: number, raw: string): PlayerGameDto[] =>
    (JSON.parse(raw) as CrGame[]).map((g, n) => {
      const o = 'opp' in g ? oppOf.get(`${tid}:${g.opp}`) : undefined;
      return {
        round: n + 1,
        kind: g.kind,
        color: 'color' in g ? g.color : null,
        score: 'score' in g ? g.score : null,
        oppName: o ? o.cr_name.replace(',', '') : null,
        oppRtg: o?.rtg ?? null,
        oppPlayerId: o?.player_id ?? null,
      };
    });
  const sp = seasonId ? await c.env.DB.prepare('SELECT postup FROM season_players WHERE season_id = ? AND player_id = ?').bind(seasonId, id).first<{ postup: string | null }>() : null;
  const dto: PlayerDetailDto = {
    player: playerDto(p, { startYear: season?.start_year ?? new Date().getFullYear(), hd8: settings.hd8, tournaments: rows.results.length, rzlElo: elo.length ? elo[elo.length - 1].after : null, postup: sp?.postup ?? null, issues: 0 }),
    instances: insts.results.map((i) => ({
      id: i.id,
      status: i.status,
      how: i.how,
      reason: i.reason,
      crName: i.cr_name,
      lokId: i.lok_id,
      club: i.club_raw,
      birthYear: i.birth_year,
      rows: i.n,
      firstDate: i.first_date,
      lastDate: i.last_date,
    })),
    results: rows.results.map((r) => {
      const st = elo.find((s) => s.tournamentId === r.tournament_id);
      return {
        entryId: r.id,
        seasonId: r.season_id,
        seasonName: r.season_name,
        tournamentId: r.tournament_id,
        linkName: r.link_name,
        date: r.date,
        group: r.grp,
        crName: r.cr_name,
        crLokId: r.cr_lok_id,
        clubRaw: r.club_raw,
        rtg: r.rtg,
        points: r.points_override ?? r.points,
        rank: r.rank_override ?? r.rank,
        match: r.match,
        instanceId: r.instance_id,
        excluded: !!r.excluded,
        eloBefore: st?.before ?? null,
        eloDelta: st?.delta ?? null,
        eloAfter: st?.after ?? null,
        rzl: rzl.get(r.id) ?? null,
        games: gamesOf(r.tournament_id, r.games),
      };
    }),
  };
  return c.json(dto);
});

players.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await getPlayer(c.env.DB, id);
  const b = await c.req.json<Partial<{ surname: string; firstName: string; gender: string | null; birthYear: number | null; clubId: number | null; regionOverride: string | null; note: string | null; lokId: number | null }>>();
  const surname = b.surname?.trim() || p.surname;
  const firstName = b.firstName !== undefined ? b.firstName.trim() : p.first_name;
  if (b.lokId !== undefined && b.lokId !== p.lok_id && b.lokId) {
    const other = await c.env.DB.prepare('SELECT id FROM players WHERE lok_id = ? AND id != ?').bind(b.lokId, id).first();
    if (other) fail(409, `LOK ${b.lokId} už má jiný hráč — použijte sloučení`);
  }
  if (b.lokId !== undefined && (b.lokId || null) !== p.lok_id) {
    // LOK ID corrected by hand: chess.cz facts taken from the wrong ID are dropped. The instances keep the LOK the
    // tournaments wrote, so later imports with the wrong ID still find this player.
    await c.env.DB.prepare(
      `UPDATE players SET chesscz = NULL, chesscz_at = NULL,
         birth_year = CASE WHEN birth_source = 'chesscz' THEN NULL ELSE birth_year END,
         birth_source = CASE WHEN birth_source = 'chesscz' THEN NULL ELSE birth_source END,
         gender = CASE WHEN gender_source = 'chesscz' THEN ? ELSE gender END,
         gender_source = CASE WHEN gender_source = 'chesscz' THEN 'guess' ELSE gender_source END
       WHERE id = ?`
    ).bind(guessGender(surname), id).run();
    if (p.gender_source === 'chesscz') p.gender = guessGender(surname);
    p.birth_year = p.birth_source === 'chesscz' ? null : p.birth_year;
    p.birth_source = p.birth_source === 'chesscz' ? null : p.birth_source;
    p.gender_source = p.gender_source === 'chesscz' ? 'guess' : p.gender_source;
  }
  await c.env.DB.prepare(
    `UPDATE players SET surname = ?, first_name = ?, name_key = ?,
       gender = ?, gender_source = ?, birth_year = ?, birth_source = ?,
       club_id = ?, club_locked = ?, region_override = ?, note = ?, lok_id = ?
     WHERE id = ?`
  )
    .bind(
      surname,
      firstName,
      nameKey(surname, firstName),
      b.gender !== undefined ? b.gender : p.gender,
      b.gender !== undefined ? 'manual' : p.gender_source,
      b.birthYear !== undefined ? b.birthYear : p.birth_year,
      b.birthYear !== undefined ? 'manual' : p.birth_source,
      b.clubId !== undefined ? b.clubId : p.club_id,
      b.clubId !== undefined ? 1 : p.club_locked,
      b.regionOverride !== undefined ? b.regionOverride : p.region_override,
      b.note !== undefined ? b.note : p.note,
      b.lokId !== undefined ? b.lokId || null : p.lok_id,
      id
    )
    .run();
  const ch: string[] = [];
  if (surname !== p.surname || firstName !== p.first_name) ch.push(`jméno ${p.surname} ${p.first_name} → ${surname} ${firstName}`);
  if (b.lokId !== undefined && (b.lokId || null) !== p.lok_id) ch.push(`LOK ${p.lok_id ?? '–'} → ${b.lokId || '–'}`);
  if (b.gender !== undefined && (b.gender !== p.gender || p.gender_source !== 'manual')) ch.push(`pohlaví ${b.gender === 'F' ? 'dívka' : b.gender === 'M' ? 'chlapec' : '–'}`);
  if (b.birthYear !== undefined && b.birthYear !== p.birth_year) ch.push(`rok narození ${p.birth_year ?? '–'} → ${b.birthYear ?? '–'}`);
  if (b.clubId !== undefined && b.clubId !== p.club_id) ch.push('oddíl');
  if (b.regionOverride !== undefined && b.regionOverride !== p.region_override)
    ch.push(b.regionOverride === 'in' ? 'region: patří' : b.regionOverride === 'out' ? 'region: nepatří' : 'region podle oddílu');
  if (b.note !== undefined && b.note !== p.note) ch.push('poznámka');
  if (ch.length) await logDecision(c.env.DB, { seasonId: await seasonOfPlayer(c.env.DB, id), kind: 'player', title: `Hráč ${rzlLabel(id)} ${surname} ${firstName}: ${ch.join(', ')}`, playerId: id });
  return c.json({ ok: true });
});

/** Merge player `sourceId` into `:id`: its instances (and rows) move over, known facts the target lacks are kept, source is deleted. */
players.post('/:id/merge', async (c) => {
  const id = Number(c.req.param('id'));
  const { sourceId } = await c.req.json<{ sourceId: number }>();
  if (sourceId === id) fail(400, 'Nelze sloučit hráče se sebou samým');
  const target = await getPlayer(c.env.DB, id);
  const src = await getPlayer(c.env.DB, sourceId);
  const db = c.env.DB;
  await logDecision(db, {
    seasonId: await seasonOfPlayer(db, sourceId),
    kind: 'merge',
    title: `Sloučeno: ${await playerLabel(db, sourceId)} → ${await playerLabel(db, id)}`,
    playerId: id,
  });
  await moveInstances(db, sourceId, id);
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO season_players (season_id, player_id, postup, note) SELECT season_id, ?, postup, note FROM season_players WHERE player_id = ?').bind(id, sourceId),
    db.prepare('DELETE FROM players WHERE id = ?').bind(sourceId),
    db
      .prepare(
        `UPDATE players SET birth_year = COALESCE(birth_year, ?), birth_source = COALESCE(birth_source, ?), lok_id = COALESCE(lok_id, ?),
           chesscz = COALESCE(chesscz, ?), chesscz_at = COALESCE(chesscz_at, ?),
           gender = CASE WHEN gender_source = 'guess' AND ? != 'guess' THEN ? ELSE gender END,
           gender_source = CASE WHEN gender_source = 'guess' AND ? != 'guess' THEN ? ELSE gender_source END
         WHERE id = ?`
      )
      .bind(src.birth_year, src.birth_source, target.lok_id ? null : src.lok_id, target.lok_id ? null : src.chesscz, target.lok_id ? null : src.chesscz_at,
        src.gender_source ?? 'guess', src.gender, src.gender_source ?? 'guess', src.gender_source, id),
  ];
  // lok_id is UNIQUE: clear it on the source before moving it to the target.
  if (!target.lok_id && src.lok_id) stmts.unshift(db.prepare('UPDATE players SET lok_id = NULL WHERE id = ?').bind(sourceId));
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** Refresh one player from chess.cz (birth year, gender, current name). */
players.post('/:id/chesscz', async (c) => {
  const p = await getPlayer(c.env.DB, Number(c.req.param('id')));
  const r = await enrichFromChesscz(c.env.DB, p, true);
  if (r === 'unavailable') fail(503, 'chess.cz není dostupné');
  return c.json({ ok: true, result: r });
});

export async function enrichFromChesscz(db: D1Database, p: PlayerRow, force = false): Promise<'ok' | 'notfound' | 'unavailable' | 'skip'> {
  if (!p.lok_id) return 'skip';
  const m = await getMember(db, p.lok_id, force);
  if (m.status === 'unavailable') return 'unavailable';
  if (m.status === 'notfound') {
    await db.prepare('UPDATE players SET chesscz = NULL, chesscz_at = ? WHERE id = ?').bind(Date.now(), p.id).run();
    return 'notfound';
  }
  const d = m.data;
  await db
    .prepare(
      `UPDATE players SET chesscz = ?1, chesscz_at = ?2,
         birth_year = CASE WHEN birth_source = 'manual' OR ?7 THEN birth_year ELSE COALESCE(?3, birth_year) END,
         birth_source = CASE WHEN birth_source = 'manual' OR ?7 THEN birth_source WHEN ?4 IS NOT NULL THEN 'chesscz' ELSE birth_source END,
         gender = CASE WHEN gender_source = 'manual' OR ?7 THEN gender ELSE ?5 END,
         gender_source = CASE WHEN gender_source = 'manual' OR ?7 THEN gender_source ELSE 'chesscz' END
       WHERE id = ?6`
    )
    .bind(
      JSON.stringify({
        fullName: d.fullName,
        birthYear: d.birthYear,
        gender: d.gender,
        clubName: d.clubName,
        clubId: d.clubId,
        registration: d.registration,
        czeStdElo: d.czeStdElo || 0,
        czeRapidElo: d.czeRapidElo || 0,
        fideId: d.fideId || 0,
        fideStdElo: d.fideStdElo || 0,
        fideRapidElo: d.fideRapidElo || 0,
        fideBlitzElo: d.fideBlitzElo || 0,
      } satisfies ChessczInfo),
      Date.now(),
      d.birthYear,
      d.birthYear,
      d.gender,
      p.id,
      // A LOK whose chess.cz record has a wrong name (operator's verdict): only Elo and registration are used.
      (await lokVerdict(db, p.lok_id)) === 'cz-error' ? 1 : 0
    )
    .run();
  // The tournament swapped surname and first name (common with Vietnamese names): take the order from chess.cz.
  const compact = (x: string) => fold(x).replace(/\s+/g, ' ').trim();
  if (p.first_name && compact(d.fullName) === compact(`${p.first_name} ${p.surname}`) && compact(d.fullName) !== compact(`${p.surname} ${p.first_name}`)) {
    await db.prepare('UPDATE players SET surname = ?1, first_name = ?2, name_key = ?3 WHERE id = ?4').bind(p.first_name, p.surname, nameKey(p.first_name, p.surname), p.id).run();
    await logDecision(db, {
      seasonId: await seasonOfPlayer(db, p.id),
      kind: 'player',
      title: `Jméno podle chess.cz: ${p.surname} ${p.first_name} → ${p.first_name} ${p.surname} (prohozené příjmení a jméno v turnaji)`,
      playerId: p.id,
    });
    return 'ok';
  }
  await reopenOnLokConflict(db, p.id, p.lok_id, d.fullName, `${p.surname} ${p.first_name}`);
  return 'ok';
}

/**
 * Birth year of an instance from the chess-results player card (art=9) of one of its rows. A player without LOK
 * takes it unless set by hand; a differing year is reported by the checks.
 */
export async function enrichInstanceFromCr(db: D1Database, instanceId: number): Promise<'ok' | 'notfound'> {
  const e = await db
    .prepare('SELECT t.tnr, e.snr FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.instance_id = ? ORDER BY t.id DESC LIMIT 1')
    .bind(instanceId)
    .first<{ tnr: number; snr: number }>();
  if (!e) {
    await db.prepare('UPDATE player_instances SET birth_checked = 1 WHERE id = ?').bind(instanceId).run();
    return 'notfound';
  }
  const info = parsePlayerInfo(await fetchPage(db, e.tnr, 9, `&snr=${e.snr}`));
  // Remember the attempt even without a result so the batch does not retry forever.
  await db.prepare('UPDATE player_instances SET birth_year = ?, birth_checked = 1 WHERE id = ?').bind(info.birthYear, instanceId).run();
  if (info.birthYear)
    await db
      .prepare(
        `UPDATE players SET birth_year = ?, birth_source = 'cr'
         WHERE id = (SELECT player_id FROM player_instances WHERE id = ?)
           AND (lok_id IS NULL OR lok_id IN (SELECT lok_id FROM lok_verdicts WHERE verdict = 'cz-error')) AND birth_year IS NULL AND (birth_source IS NULL OR birth_source NOT IN ('manual', 'chesscz'))`
      )
      .bind(info.birthYear, instanceId)
      .run();
  return info.birthYear ? 'ok' : 'notfound';
}
