import { Hono } from 'hono';
import type { InstanceDto, PlayerBriefDto } from '../../shared/types';
import { fail } from '../lib/http';
import { assignInstance, confirmInstances, getInstance, loadIndex, newPlayerFromInstance } from '../lib/instances';
import { chessczOf, eligibility, loadSeason, playerName, type PlayerRow } from '../lib/season';
import type { AppEnv } from '../types';

export const instances = new Hono<AppEnv>();

/** Instances appearing in a season, with their rows, player, differences and (for open ones) candidates. */
instances.get('/seasons/:id/instances', async (c) => {
  const seasonId = Number(c.req.param('id'));
  const db = c.env.DB;
  const L = await loadSeason(db, seasonId);
  const idx = await loadIndex(db);
  const counts = await db.prepare('SELECT player_id, COUNT(*) AS n FROM player_instances WHERE player_id IS NOT NULL GROUP BY player_id').all<{ player_id: number; n: number }>();
  const nInst = new Map(counts.results.map((r) => [r.player_id, r.n]));
  // All instances with the date they first appear (to compare an instance with the one it replaced).
  const all = await db
    .prepare(
      `SELECT i.id, i.player_id, i.cr_name, i.name_key, i.lok_id, i.club_raw,
         (SELECT MIN(r.date) FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = i.id) AS first_date
       FROM player_instances i ORDER BY first_date, i.id`
    )
    .all<{ id: number; player_id: number | null; cr_name: string; name_key: string; lok_id: number | null; club_raw: string; first_date: string | null }>();
  const instOf = new Map<number, typeof all.results>();
  for (const i of all.results) if (i.player_id != null) (instOf.get(i.player_id) ?? instOf.set(i.player_id, []).get(i.player_id)!).push(i);
  // Instances seen in an earlier season.
  const earlier = await db
    .prepare(
      `SELECT DISTINCT e.instance_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN seasons s ON s.id = t.season_id
       WHERE s.start_year < (SELECT start_year FROM seasons WHERE id = ?) AND e.instance_id IS NOT NULL`
    )
    .bind(seasonId)
    .all<{ instance_id: number }>();
  const recycled = new Set(earlier.results.map((r) => r.instance_id));
  const byId = new Map(L.allPlayers.map((p) => [p.id, p]));
  const brief = (p: PlayerRow): PlayerBriefDto => ({
    id: p.id,
    name: playerName(p),
    lokId: p.lok_id,
    birthYear: p.birth_year,
    club: p.club_name,
    clubId: p.club_id,
    czName: chessczOf(p)?.fullName ?? null,
    gender: p.gender,
    genderSource: p.gender_source,
    eligibility: eligibility(p),
    instances: nInst.get(p.id) ?? 0,
  });
  const aliases = await db.prepare('SELECT raw_key, club_id FROM club_aliases').all<{ raw_key: string; club_id: number }>();
  const clubOfKey = new Map(aliases.results.map((a) => [a.raw_key, a.club_id]));
  const tById = new Map(L.tournaments.map((t) => [t.id, t]));
  const rowsOf = new Map<number, InstanceDto['rows']>();
  for (const e of L.entries) {
    if (e.instance_id == null) continue;
    const t = tById.get(e.tournament_id)!;
    (rowsOf.get(e.instance_id) ?? rowsOf.set(e.instance_id, []).get(e.instance_id)!).push({
      entryId: e.id,
      tournamentId: t.id,
      linkName: t.link_name,
      round: L.roundById.get(t.round_id)!.ordinal,
      grp: t.grp,
      snr: e.snr,
      rank: e.rank_override ?? e.rank,
      points: e.points_override ?? e.points,
      mark: e.cr_mark,
      manual: e.match === 'manual',
    });
  }
  const out: InstanceDto[] = [...L.instances.values()].map((i) => {
    const rows = (rowsOf.get(i.id) ?? []).sort((a, b) => a.round - b.round || a.grp.localeCompare(b.grp));
    const p = i.player_id != null ? byId.get(i.player_id) : undefined;
    const changes: string[] = [];
    if (p) {
      // Compare with the player's previous instance (the one this one most likely replaced in Swiss Manager).
      const list = instOf.get(p.id) ?? [];
      const pos = list.findIndex((x) => x.id === i.id);
      const prev = pos > 0 ? list[pos - 1] : undefined;
      if (prev) {
        if (prev.name_key !== i.name_key) changes.push(`jméno: ${prev.cr_name} → ${i.cr_name}`);
        if ((prev.lok_id ?? 0) !== (i.lok_id ?? 0)) changes.push(`LOK: ${prev.lok_id ?? '–'} → ${i.lok_id ?? '–'}`);
        if (prev.club_raw !== i.club_raw) changes.push(`oddíl: ${prev.club_raw || '–'} → ${i.club_raw || '–'}`);
      }
      if (i.lok_id && p.lok_id !== i.lok_id) changes.push(`LOK v turnaji ${i.lok_id}, v evidenci aplikace ${p.lok_id ?? 'bez LOK'}`);
      if (!i.lok_id && p.lok_id) changes.push(`v turnaji bez LOK, v evidenci aplikace LOK ${p.lok_id}`);
      if (i.birth_year && p.birth_year && i.birth_year !== p.birth_year) changes.push(`rok narození v turnaji ${i.birth_year}, v evidenci aplikace ${p.birth_year}`);
    }
    const candidates =
      i.player_id == null
        ? idx
            .candidates({ nameKey: i.name_key, lokId: i.lok_id, clubKey: i.club_key })
            .slice(0, 6)
            .flatMap((cd) => {
              const cp = byId.get(cd.playerId);
              return cp ? [{ player: brief(cp), why: cd.why }] : [];
            })
        : [];
    // A LOK held by a player with another name is the first candidate (see IdentityIndex.resolve).
    if (i.player_id == null && i.lok_id) {
      const holder = L.allPlayers.find((x) => x.lok_id === i.lok_id);
      if (holder && !candidates.some((x) => x.player.id === holder.id)) candidates.unshift({ player: brief(holder), why: `stejné LOK ${i.lok_id}, jiné jméno` });
    }
    return {
      id: i.id,
      status: i.status,
      how: i.how,
      reason: i.reason,
      crName: i.cr_name,
      lokId: i.lok_id,
      club: i.club_raw,
      clubId: clubOfKey.get(i.club_key) ?? null,
      birthYear: i.birth_year,
      birthChecked: !!i.birth_checked,
      firstRound: rows[0]?.round ?? 0,
      recycled: recycled.has(i.id),
      rows,
      player: p ? brief(p) : null,
      changes,
      candidates,
    };
  });
  out.sort((a, b) => a.firstRound - b.firstRound || a.id - b.id);
  return c.json(out);
});

/** Assign the instance to a player (confirmed decision). */
instances.post('/instances/:id/assign', async (c) => {
  const { playerId } = await c.req.json<{ playerId: number }>();
  if (!playerId) fail(400, 'Chybí hráč');
  await assignInstance(c.env.DB, Number(c.req.param('id')), playerId);
  return c.json({ ok: true });
});

/** The instance is somebody not yet in the register: new player. */
instances.post('/instances/:id/new-player', async (c) => {
  const playerId = await newPlayerFromInstance(c.env.DB, Number(c.req.param('id')));
  return c.json({ playerId });
});

/** Confirm automatic assignments (checked by the operator). */
instances.post('/instances/confirm', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.length) fail(400, 'Nic k potvrzení');
  return c.json({ confirmed: await confirmInstances(c.env.DB, ids) });
});

/** Back to "to check" (undo a confirmation). */
instances.post('/instances/:id/unconfirm', async (c) => {
  const i = await getInstance(c.env.DB, Number(c.req.param('id')));
  if (i.player_id == null) fail(400, 'Instance není přiřazena');
  await c.env.DB.prepare("UPDATE player_instances SET status = 'auto', decided_at = NULL WHERE id = ?").bind(i.id).run();
  return c.json({ ok: true });
});
