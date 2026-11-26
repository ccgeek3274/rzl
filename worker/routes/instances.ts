import { Hono } from 'hono';
import type { InstanceDto, LokCheckDto, PlayerBriefDto } from '../../shared/types';
import { sameRegisteredName } from '../../shared/text';
import { fail } from '../lib/http';
import { crLabel, logDecision, playerLabel, seasonOfInstance } from '../lib/log';
import { LOK_VERDICT } from '../../shared/lokcheck';
import { enrichFromChesscz, enrichInstanceFromCr } from './players';
import { assignInstance, confirmInstances, decideLok, getInstance, loadIndex, newPlayerFromInstance } from '../lib/instances';
import { cachedClub, cachedMember } from '../lib/chesscz';
import { lokHints, type LokVerdict } from '../../shared/lokcheck';
import { chessczOf, eligibility, loadSeason, playerName, roundsByPlayer, sharedRound, type PlayerRow } from '../lib/season';
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
      `SELECT i.id, i.player_id, i.cr_name, i.name_key, i.lok_id, i.club_raw, i.club_key,
         (SELECT MIN(r.date) FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = i.id) AS first_date
       FROM player_instances i ORDER BY first_date, i.id`
    )
    .all<{ id: number; player_id: number | null; cr_name: string; name_key: string; lok_id: number | null; club_raw: string; club_key: string; first_date: string | null }>();
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
  const clubName = new Map((await db.prepare('SELECT id, name FROM clubs').all<{ id: number; name: string }>()).results.map((x) => [x.id, x.name]));
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
  // Open instances whose LOK chess.cz has under another name, with no verdict yet: evidence for the decision.
  const verdicts = new Set((await db.prepare('SELECT lok_id FROM lok_verdicts').all<{ lok_id: number }>()).results.map((r) => r.lok_id));
  const lokChecks = new Map<number, LokCheckDto>();
  for (const i of L.instances.values()) {
    if (i.player_id != null || !i.lok_id || verdicts.has(i.lok_id)) continue;
    const cz = await cachedMember(db, i.lok_id);
    if (!cz || sameRegisteredName(cz.fullName, i.cr_name)) continue;
    const club = cz.clubId ? await cachedClub(db, cz.clubId) : null;
    const laterCzName = all.results.some((x) => x.lok_id === i.lok_id && x.id !== i.id && sameRegisteredName(cz.fullName, x.cr_name));
    lokChecks.set(i.id, {
      lokId: i.lok_id,
      cz: { fullName: cz.fullName, gender: cz.gender, birthYear: cz.birthYear, clubName: cz.clubName, czeStdElo: cz.czeStdElo || 0, czeRapidElo: cz.czeRapidElo || 0, registration: cz.registration ?? null },
      clubLoaded: !!club,
      ...lokHints({ lokId: i.lok_id, crName: i.cr_name, crBirth: i.birth_year, cz, club, laterCzName }),
    });
  }
  const playerRounds = roundsByPlayer(L);
  const instRounds = roundsByPlayer(L, 'instance');
  const out: InstanceDto[] = [...L.instances.values()].map((i) => {
    const rows = (rowsOf.get(i.id) ?? []).sort((a, b) => a.round - b.round || a.grp.localeCompare(b.grp));
    const p = i.player_id != null ? byId.get(i.player_id) : undefined;
    const changes: string[] = [];
    let before: InstanceDto['before'] = null;
    if (p) {
      // Compare with the player's previous instance (the one this one most likely replaced in Swiss Manager).
      const list = instOf.get(p.id) ?? [];
      const pos = list.findIndex((x) => x.id === i.id);
      const prev = pos > 0 ? list[pos - 1] : undefined;
      if (prev) {
        // The player as the app had them before this instance (LOK taken over from it / club of the previous tournament).
        const lokFromHere = p.lok_id != null && p.lok_id === i.lok_id && !list.slice(0, pos).some((x) => x.lok_id === p.lok_id);
        const prevClub = clubOfKey.get(prev.club_key) ?? null;
        before = { created: false, lokId: lokFromHere ? null : p.lok_id, clubId: prevClub, club: prevClub != null ? (clubName.get(prevClub) ?? prev.club_raw) : prev.club_raw };
        if (prev.name_key !== i.name_key) changes.push(`jméno: ${prev.cr_name} → ${i.cr_name}`);
        if ((prev.lok_id ?? 0) !== (i.lok_id ?? 0)) changes.push(`LOK: ${prev.lok_id ?? '–'} → ${i.lok_id ?? '–'}`);
        if (prev.club_raw !== i.club_raw) changes.push(`oddíl: ${prev.club_raw || '–'} → ${i.club_raw || '–'}`);
      } else if (pos === 0 && list.length > 1) {
        // The player's first instance: the player as created from it (later tournaments may have added LOK / club).
        const own = clubOfKey.get(i.club_key) ?? null;
        before = { created: true, lokId: p.lok_id != null && p.lok_id === i.lok_id ? p.lok_id : null, clubId: own, club: own != null ? (clubName.get(own) ?? i.club_raw) : i.club_raw };
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
              return cp ? [{ player: brief(cp), why: cd.why, sameRound: sharedRound(instRounds.get(i.id), playerRounds.get(cp.id)) }] : [];
            })
        : [];
    // A LOK held by a player with another name is the first candidate (see IdentityIndex.resolve).
    if (i.player_id == null && i.lok_id) {
      const holder = L.allPlayers.find((x) => x.lok_id === i.lok_id);
      if (holder) {
        const cz = chessczOf(holder)?.fullName;
        const why = cz && !sameRegisteredName(cz, i.cr_name) ? `stejné LOK ${i.lok_id}, na chess.cz ale „${cz}“` : `stejné LOK ${i.lok_id}, jiné jméno`;
        const at = candidates.findIndex((x) => x.player.id === holder.id);
        if (at >= 0) candidates.splice(at, 1);
        candidates.unshift({ player: brief(holder), why, sameRound: sharedRound(instRounds.get(i.id), playerRounds.get(holder.id)) });
      }
    }
    // Candidates playing in the same round cannot be this player: last.
    candidates.sort((a, b) => Number(!!a.sameRound) - Number(!!b.sameRound));
    return {
      lokCheck: lokChecks.get(i.id) ?? null,
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
      before,
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
  const db = c.env.DB;
  const iid = Number(c.req.param('id'));
  const before = await getInstance(db, iid);
  const note = await assignInstance(db, iid, playerId);
  await logDecision(db, {
    seasonId: await seasonOfInstance(db, iid),
    kind: 'pairing',
    title: `Párování: ${crLabel(before.cr_name)} → ${await playerLabel(db, playerId)}`,
    detail: [before.player_id && before.player_id !== playerId ? `dříve ${await playerLabel(db, before.player_id)}` : null, note].filter(Boolean).join('; ') || null,
    playerId,
    instanceId: iid,
  });
  // A player who has just taken the LOK gets the chess.cz data right away (otherwise "nenačteno z chess.cz").
  const p = await db.prepare('SELECT p.*, NULL AS club_name, NULL AS club_region FROM players p WHERE id = ?').bind(playerId).first<PlayerRow>();
  if (p?.lok_id && !p.chesscz_at) await enrichFromChesscz(db, p).catch(() => null);
  return c.json({ ok: true, note });
});

/** The instance is somebody not yet in the register: new player. */
instances.post('/instances/:id/new-player', async (c) => {
  const id = Number(c.req.param('id'));
  const playerId = await newPlayerFromInstance(c.env.DB, id);
  const inst = await getInstance(c.env.DB, id);
  await logDecision(c.env.DB, {
    seasonId: await seasonOfInstance(c.env.DB, id),
    kind: 'pairing',
    title: `Párování: ${crLabel(inst.cr_name)} → nový hráč ${await playerLabel(c.env.DB, playerId)}`,
    playerId,
    instanceId: id,
  });
  // A player without LOK (e.g. a wrong LOK in the tournament) gets the birth year from the chess-results card right away.
  const i = await getInstance(c.env.DB, id);
  if (!i.birth_checked) await enrichInstanceFromCr(c.env.DB, id).catch(() => null);
  return c.json({ playerId });
});

/** Whose is the instance's LOK (chess.cz has it under another name): cz | cz-error | bad-lok. */
instances.post('/instances/:id/lok-verdict', async (c) => {
  const { verdict } = await c.req.json<{ verdict: LokVerdict }>();
  if (!['cz', 'cz-error', 'bad-lok'].includes(verdict)) fail(400, 'Neplatné rozhodnutí');
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const r = await decideLok(db, id, verdict);
  const inst = await getInstance(db, id);
  await logDecision(db, {
    seasonId: await seasonOfInstance(db, id),
    kind: 'lok',
    title: `LOK ${inst.lok_id}: ${LOK_VERDICT[verdict]} (${crLabel(inst.cr_name)})`,
    detail: r.message,
    playerId: r.playerId,
    instanceId: id,
  });
  if (r.playerId) {
    // chess.cz facts (gender, birth year; for a wrong record only Elo), then the birth year from the card for a player without them.
    const p = await db.prepare('SELECT p.*, NULL AS club_name, NULL AS club_region FROM players p WHERE id = ?').bind(r.playerId).first<PlayerRow>();
    if (p?.lok_id) await enrichFromChesscz(db, p);
    const i = await getInstance(db, id);
    if (!i.birth_checked && verdict !== 'cz') await enrichInstanceFromCr(db, id).catch(() => null);
  }
  return c.json(r);
});

/** Confirm automatic assignments (checked by the operator). */
instances.post('/instances/confirm', async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.length) fail(400, 'Nic k potvrzení');
  const db = c.env.DB;
  const pending = await Promise.all(ids.map((i) => getInstance(db, i).catch(() => null)));
  const confirmed = await confirmInstances(db, ids);
  for (const i of pending)
    if (i && i.player_id != null && i.status !== 'ok')
      await logDecision(db, {
        seasonId: await seasonOfInstance(db, i.id),
        kind: 'pairing',
        title: `Potvrzeno: ${crLabel(i.cr_name)} → ${await playerLabel(db, i.player_id)}`,
        playerId: i.player_id,
        instanceId: i.id,
      });
  return c.json({ confirmed });
});

/** Back to "to check" (undo a confirmation). */
instances.post('/instances/:id/unconfirm', async (c) => {
  const i = await getInstance(c.env.DB, Number(c.req.param('id')));
  if (i.player_id == null) fail(400, 'Instance není přiřazena');
  await c.env.DB.prepare("UPDATE player_instances SET status = 'auto', decided_at = NULL WHERE id = ?").bind(i.id).run();
  await logDecision(c.env.DB, {
    seasonId: await seasonOfInstance(c.env.DB, i.id),
    kind: 'pairing',
    title: `Vráceno ke kontrole: ${crLabel(i.cr_name)} → ${await playerLabel(c.env.DB, i.player_id)}`,
    playerId: i.player_id,
    instanceId: i.id,
  });
  return c.json({ ok: true });
});
