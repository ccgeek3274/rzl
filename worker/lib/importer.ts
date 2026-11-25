// Import from chess-results: discover the season's linked tournaments, fetch + parse each tournament,
// and resolve every result row to a player instance (see shared/identity.ts, worker/lib/instances.ts).
import { parseLinked, parseTitle, parseTitleFacts, parseTournament, placeFromTitle, splitLinkedName } from '../../shared/chessresults';
import { clubKey, clubShortName } from '../../shared/clubs';
import { fetchDetails, fetchPage } from './chessresults';
import { fail, now } from './http';
import { dropIfOrphan, instanceForRow, loadIndex } from './instances';

export type SeasonRow = { id: number; name: string; start_year: number; seed_tnr: number; settings: string };

/** Read linked tournaments from the seed and upsert rounds + tournaments. Returns the number of tournaments. */
export async function discover(db: D1Database, season: SeasonRow): Promise<{ total: number; added: number }> {
  const html = await fetchDetails(db, season.seed_tnr);
  const linked = parseLinked(html, season.seed_tnr);
  if (!linked.length) fail(422, 'V detailu turnaje chybí seznam navázaných turnajů (Výběr turnaje)');
  const seedTitle = parseTitle(html);

  // Rounds in order of first appearance of the place.
  const places: string[] = [];
  for (const l of linked) {
    const { place } = splitLinkedName(l.name);
    if (!places.includes(place)) places.push(place);
  }
  for (let i = 0; i < places.length; i++) {
    await db
      .prepare(
        `INSERT INTO rounds (season_id, ordinal, place, place_key) VALUES (?, ?, ?, ?)
         ON CONFLICT(season_id, place_key) DO UPDATE SET ordinal = excluded.ordinal`
      )
      .bind(season.id, i + 1, places[i], places[i])
      .run();
  }
  const rounds = await db.prepare('SELECT id, place_key FROM rounds WHERE season_id = ?').bind(season.id).all<{ id: number; place_key: string }>();
  const roundId = new Map(rounds.results.map((r) => [r.place_key, r.id]));

  let added = 0;
  for (const l of linked) {
    const { place, group } = splitLinkedName(l.name);
    const res = await db
      .prepare(
        `INSERT INTO tournaments (season_id, round_id, tnr, grp, link_name) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(season_id, tnr) DO UPDATE SET round_id = excluded.round_id, grp = excluded.grp, link_name = excluded.link_name`
      )
      .bind(season.id, roundId.get(place)!, l.tnr, group ?? '?', l.name)
      .run();
    if ((res.meta?.changes ?? 0) > 0 && res.meta?.last_row_id) added++;
  }
  // Season name/year from the seed title when still default.
  const facts = parseTitleFacts(seedTitle);
  await db.prepare('UPDATE seasons SET discovered_at = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?').bind(now(), facts.season ?? '', season.id).run();
  return { total: linked.length, added };
}

type TournamentRow = { id: number; season_id: number; round_id: number; tnr: number; grp: string; link_name: string };

/** Fetch art=0 + art=5 for one tournament, store raw HTML and re-import entries. */
export async function fetchTournament(db: D1Database, t: TournamentRow): Promise<{ players: number; created: number }> {
  let start: string;
  let cross: string;
  try {
    start = await fetchPage(db, t.tnr, 0);
    cross = await fetchPage(db, t.tnr, 5);
  } catch (e) {
    await db.prepare("UPDATE tournaments SET status = 'error', error = ? WHERE id = ?").bind((e as Error).message, t.id).run();
    throw e;
  }
  await db.prepare('UPDATE tournaments SET raw_start = ?, raw_cross = ? WHERE id = ?').bind(start, cross, t.id).run();
  return importTournament(db, t, start, cross);
}

/** Parse stored HTML and upsert entries (keeps manual overrides and manual player assignment). */
export async function importTournament(db: D1Database, t: TournamentRow, start: string, cross: string): Promise<{ players: number; created: number }> {
  const parsed = parseTournament(start, cross);
  if (!parsed.players.length) {
    await db.prepare("UPDATE tournaments SET status = 'error', error = ?, fetched_at = ? WHERE id = ?").bind('Tabulka je prázdná (turnaj ještě neproběhl?)', now(), t.id).run();
    return { players: 0, created: 0 };
  }
  const facts = parseTitleFacts(parsed.title);
  const { place } = splitLinkedName(t.link_name);
  await db
    .prepare(
      `UPDATE tournaments SET title = ?, cr_last_update = ?, rounds_count = ?, player_count = ?, status = 'fetched', error = NULL, fetched_at = ?,
         grp = CASE WHEN grp = '?' AND ? IS NOT NULL THEN ? ELSE grp END WHERE id = ?`
    )
    .bind(parsed.title, parsed.lastUpdate, parsed.rounds, parsed.players.length, now(), facts.group, facts.group, t.id)
    .run();
  if (facts.date) {
    await db
      .prepare('UPDATE rounds SET date = COALESCE(date, ?), place = CASE WHEN place = place_key THEN ? ELSE place END WHERE id = ?')
      .bind(facts.date, placeFromTitle(parsed.title, place), t.round_id)
      .run();
  }
  const date = facts.date ?? '';

  const existing = await db
    .prepare('SELECT id, snr, cr_name, instance_id, player_id, match FROM entries WHERE tournament_id = ?')
    .bind(t.id)
    .all<{ id: number; snr: number; cr_name: string; instance_id: number | null; player_id: number | null; match: string | null }>();
  const bySnr = new Map(existing.results.map((e) => [e.snr, e]));
  const idx = await loadIndex(db);
  let created = 0;
  const seen = new Set<number>();
  for (const p of parsed.players) {
    seen.add(p.snr);
    const prev = bySnr.get(p.snr);
    const inst = await instanceForRow(db, idx, p.name, p.lokId, p.club, date || null);
    if (inst.created) created++;
    // A row assigned by hand stays so while it is still the same instance.
    const keepManual = prev && prev.match === 'manual' && prev.instance_id === inst.id;
    const playerId = keepManual ? prev!.player_id : inst.playerId;
    const match = keepManual ? 'manual' : null;
    const sameRow = prev && prev.cr_name === p.name;
    if (prev) {
      await db
        .prepare(
          `UPDATE entries SET cr_name = ?, cr_lok_id = ?, rtg = ?, club_raw = ?, points = ?, rank = ?, games = ?, player_id = ?, match = ?, instance_id = ?, cr_mark = ?,
             points_override = CASE WHEN ? THEN points_override ELSE NULL END,
             rank_override = CASE WHEN ? THEN rank_override ELSE NULL END,
             excluded = CASE WHEN ? THEN excluded ELSE 0 END
           WHERE id = ?`
        )
        .bind(p.name, p.lokId, p.rtg, p.club, p.points, p.rank, JSON.stringify(p.games), playerId, match, inst.id, p.mark, sameRow ? 1 : 0, sameRow ? 1 : 0, sameRow ? 1 : 0, prev.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO entries (tournament_id, snr, cr_name, cr_lok_id, rtg, club_raw, points, rank, games, player_id, match, instance_id, cr_mark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(t.id, p.snr, p.name, p.lokId, p.rtg, p.club, p.points, p.rank, JSON.stringify(p.games), playerId, match, inst.id, p.mark)
        .run();
    }
    if (playerId) await updatePlayerClub(db, playerId, p.club, date);
  }
  for (const e of existing.results) if (!seen.has(e.snr)) await db.prepare('DELETE FROM entries WHERE id = ?').bind(e.id).run();
  // Players created by an earlier import of this tournament whose rows went elsewhere.
  for (const e of existing.results) await dropIfOrphan(db, e.player_id);
  return { players: parsed.players.length, created };
}

export async function clubFor(db: D1Database, raw: string): Promise<number | null> {
  if (!raw.trim()) return null;
  const k = clubKey(raw);
  const a = await db.prepare('SELECT club_id FROM club_aliases WHERE raw_key = ?').bind(k).first<{ club_id: number }>();
  if (a) return a.club_id;
  const short = clubShortName(raw);
  // Another spelling of a known club (same short name) joins that club.
  let club = short !== raw.trim() ? await db.prepare('SELECT id FROM clubs WHERE name = ?').bind(short).first<{ id: number }>() : null;
  if (!club) {
    const res = await db.prepare('INSERT INTO clubs (name, full_name) VALUES (?, ?)').bind(short, raw.trim()).run();
    club = { id: Number(res.meta.last_row_id) };
  }
  await db.prepare('INSERT OR IGNORE INTO club_aliases (raw_key, raw, club_id) VALUES (?, ?, ?)').bind(k, raw.trim(), club.id).run();
  return club.id;
}

/** Club follows the most recent tournament unless set manually. */
async function updatePlayerClub(db: D1Database, playerId: number, raw: string, date: string): Promise<void> {
  const clubId = await clubFor(db, raw);
  if (!clubId) return;
  await db
    .prepare('UPDATE players SET club_id = ?, club_date = ? WHERE id = ? AND club_locked = 0 AND (club_date IS NULL OR club_date <= ?)')
    .bind(clubId, date, playerId, date)
    .run();
}
