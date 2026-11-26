// DB side of instance-based identification (logic in shared/identity.ts).
import { IdentityIndex, instanceKey, rowIdentity, type IdRow, type InstanceHow, type InstanceStatus } from '../../shared/identity';
import { fold, guessGender, nameKey, sameRegisteredName, similarNames, splitCrName } from '../../shared/text';
import { LOK_VERDICT, splitCzName, type LokVerdict } from '../../shared/lokcheck';
import { getMember } from './chesscz';
import { clubFor, updatePlayerClub } from './importer';
import { fail, now } from './http';

export type InstanceRow = {
  id: number;
  player_id: number | null;
  cr_name: string;
  name_key: string;
  lok_id: number | null;
  club_raw: string;
  club_key: string;
  birth_year: number | null;
  birth_checked: number;
  status: InstanceStatus;
  how: InstanceHow | null;
  reason: string | null;
  created_at: number;
  decided_at: number | null;
};

export async function loadIndex(db: D1Database): Promise<IdentityIndex> {
  const [roots, insts] = await Promise.all([
    db.prepare('SELECT id, lok_id, name_key FROM players').all<{ id: number; lok_id: number | null; name_key: string }>(),
    db.prepare('SELECT id, player_id, name_key, lok_id, club_key FROM player_instances ORDER BY id').all<{ id: number; player_id: number | null; name_key: string; lok_id: number | null; club_key: string }>(),
  ]);
  return new IdentityIndex(
    roots.results.map((r) => ({ id: r.id, lokId: r.lok_id, nameKey: r.name_key, clubKey: null })),
    insts.results.map((i) => ({ id: i.id, playerId: i.player_id, nameKey: i.name_key, lokId: i.lok_id, clubKey: i.club_key }))
  );
}

async function lokFree(db: D1Database, lok: number | null): Promise<boolean> {
  if (!lok) return false;
  return !(await db.prepare('SELECT 1 FROM players WHERE lok_id = ?').bind(lok).first());
}

export async function lokVerdict(db: D1Database, lokId: number | null): Promise<LokVerdict | null> {
  if (!lokId) return null;
  return (await db.prepare('SELECT verdict FROM lok_verdicts WHERE lok_id = ?').bind(lokId).first<{ verdict: LokVerdict }>())?.verdict ?? null;
}

/** New player (root) from a tournament row; the LOK is taken only when no other player has it and it was not judged wrong. */
export async function createRoot(db: D1Database, crName: string, lokId: number | null, clubRaw: string, date: string | null, name?: { surname: string; firstName: string }): Promise<number> {
  const { surname, firstName } = name ?? splitCrName(crName);
  const clubId = await clubFor(db, clubRaw);
  const lok = (await lokFree(db, lokId)) && (await lokVerdict(db, lokId)) !== 'bad-lok' ? lokId : null;
  const res = await db
    .prepare(
      `INSERT INTO players (lok_id, surname, first_name, name_key, gender, gender_source, club_id, club_date, created_at)
       VALUES (?, ?, ?, ?, ?, 'guess', ?, ?, ?)`
    )
    .bind(lok, surname, firstName, nameKey(surname, firstName), guessGender(surname), clubId, date, now())
    .run();
  return Number(res.meta.last_row_id);
}

/**
 * Instance for a tournament row: existing one, or a new one decided by the index (new player / auto / open).
 * Mutates `idx` so later rows of the same import see the new instance and player.
 */
export async function instanceForRow(db: D1Database, idx: IdentityIndex, crName: string, lokId: number | null, clubRaw: string, date: string | null): Promise<{ id: number; playerId: number | null; created: boolean }> {
  const row = rowIdentity(crName, lokId, clubRaw);
  const found = idx.find(row);
  if (found) return { id: found.id, playerId: found.playerId, created: false };
  const res = idx.resolve(row);
  let playerId: number | null = null;
  let status: InstanceStatus = 'auto';
  let how: InstanceHow | null = null;
  let created = false;
  if (res.kind === 'auto') {
    playerId = res.playerId;
    how = res.how;
  } else if (res.kind === 'new') {
    playerId = await createRoot(db, crName, lokId, clubRaw, date);
    idx.addRoot({ id: playerId, lokId: (await db.prepare('SELECT lok_id FROM players WHERE id = ?').bind(playerId).first<{ lok_id: number | null }>())?.lok_id ?? null, nameKey: row.nameKey, clubKey: row.clubKey });
    how = 'new';
    created = true;
  } else {
    status = 'open';
  }
  const ins = await db
    .prepare(
      `INSERT INTO player_instances (player_id, cr_name, name_key, lok_id, lok_key, club_raw, club_key, status, how, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(playerId, crName, row.nameKey, row.lokId, row.lokId ?? 0, clubRaw.trim(), row.clubKey, status, how, res.reason, now())
    .run();
  const id = Number(ins.meta.last_row_id);
  idx.addInstance({ id, playerId, ...row });
  return { id, playerId, created };
}

/** Rows follow their instance unless assigned by hand (match = 'manual'). */
async function syncEntries(db: D1Database, instanceId: number) {
  await db
    .prepare("UPDATE entries SET player_id = (SELECT player_id FROM player_instances WHERE id = ?) WHERE instance_id = ? AND (match IS NULL OR match != 'manual')")
    .bind(instanceId, instanceId)
    .run();
}

/** The player's club follows their most recent tournament row (also rows just assigned by hand / merged in). */
export async function syncPlayerClub(db: D1Database, playerId: number) {
  const last = await db
    .prepare('SELECT e.club_raw, r.date FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.player_id = ? AND r.date IS NOT NULL ORDER BY r.date DESC, e.id DESC LIMIT 1')
    .bind(playerId)
    .first<{ club_raw: string; date: string }>();
  if (last) await updatePlayerClub(db, playerId, last.club_raw, last.date);
}

/** Drop a player that no longer has any instance or row (it was created by an import and has been reassigned). */
export async function dropIfOrphan(db: D1Database, playerId: number | null) {
  if (!playerId) return;
  const used = await db
    .prepare('SELECT (SELECT COUNT(*) FROM player_instances WHERE player_id = ?1) + (SELECT COUNT(*) FROM entries WHERE player_id = ?1) AS n')
    .bind(playerId)
    .first<{ n: number }>();
  if (!used?.n) await db.prepare('DELETE FROM players WHERE id = ?').bind(playerId).run();
}

export async function getInstance(db: D1Database, id: number): Promise<InstanceRow> {
  const i = await db.prepare('SELECT * FROM player_instances WHERE id = ?').bind(id).first<InstanceRow>();
  if (!i) fail(404, 'Instance nenalezena');
  return i;
}

/**
 * chess.cz registers the player's LOK under another name, there is no verdict on the LOK yet and nothing about the
 * player is confirmed (all its instances are "auto", typically a new player created from a tournament row): the
 * instances go back to "open" and the player stays only as the LOK holder until the operator decides (decideLok).
 */
export async function reopenOnLokConflict(db: D1Database, playerId: number, lokId: number, czName: string, appName: string): Promise<number> {
  if (sameRegisteredName(czName, appName) || (await lokVerdict(db, lokId))) return 0;
  const insts = await db.prepare('SELECT id, status FROM player_instances WHERE player_id = ?').bind(playerId).all<{ id: number; status: InstanceStatus }>();
  if (!insts.results.length || insts.results.some((i) => i.status !== 'auto')) return 0;
  const reason = `LOK ${lokId} je na chess.cz pod jménem „${czName}“ – komu LOK patří?`;
  await db.batch([
    db
      .prepare("UPDATE player_instances SET player_id = NULL, status = 'open', how = NULL, reason = ?, decided_at = NULL WHERE player_id = ?")
      .bind(reason, playerId),
    db.prepare("UPDATE entries SET player_id = NULL WHERE player_id = ? AND (match IS NULL OR match != 'manual')").bind(playerId),
  ]);
  return insts.results.length;
}

/** A player left holding a LOK without any instance or row (see reopenOnLokConflict) goes once the instance is decided. */
async function dropOrphanLokHolder(db: D1Database, lokId: number | null) {
  if (!lokId) return;
  const h = await db.prepare('SELECT id FROM players WHERE lok_id = ?').bind(lokId).first<{ id: number }>();
  if (h) await dropIfOrphan(db, h.id);
}

const seasonsOf = (db: D1Database, instanceId: number) =>
  db.prepare('SELECT DISTINCT t.season_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.instance_id = ?').bind(instanceId).all<{ season_id: number }>();

/**
 * Birth year read for the instance (chess-results card) goes to a player who has none yet and does not take it from
 * chess.cz (no LOK, or a LOK with a wrong record on chess.cz); same rule as enrichInstanceFromCr.
 */
async function takeInstanceBirth(db: D1Database, inst: InstanceRow, playerId: number) {
  if (!inst.birth_year) return;
  await db
    .prepare(
      `UPDATE players SET birth_year = ?, birth_source = 'cr'
       WHERE id = ? AND (lok_id IS NULL OR lok_id IN (SELECT lok_id FROM lok_verdicts WHERE verdict = 'cz-error'))
         AND birth_year IS NULL AND (birth_source IS NULL OR birth_source NOT IN ('manual', 'chesscz'))`
    )
    .bind(inst.birth_year, playerId)
    .run();
}

/**
 * Operator assigns an instance to a player (confirmed). A player without LOK takes the instance's LOK when nobody
 * else has it (registration during the season); a wrong LOK is then reported by the chess.cz name check.
 */
export async function assignInstance(db: D1Database, instanceId: number, playerId: number): Promise<string | null> {
  const inst = await getInstance(db, instanceId);
  const p = await db.prepare('SELECT id, lok_id, surname, first_name FROM players WHERE id = ?').bind(playerId).first<{ id: number; lok_id: number | null; surname: string; first_name: string }>();
  if (!p) fail(404, 'Hráč nenalezen');
  await db
    .prepare("UPDATE player_instances SET player_id = ?, status = 'ok', how = CASE WHEN player_id IS ? THEN how ELSE 'manual' END, decided_at = ? WHERE id = ?")
    .bind(playerId, playerId, now(), instanceId)
    .run();
  let note: string | null = null;
  if (!p.lok_id && inst.lok_id && (await lokFree(db, inst.lok_id))) {
    // The LOK is taken when the operator judged it the player's, or chess.cz registers it under the player's name.
    const v = await lokVerdict(db, inst.lok_id);
    const m = v ? null : await getMember(db, inst.lok_id);
    if (v === 'bad-lok') note = `Přiřazeno; LOK ${inst.lok_id} je v turnaji chybné, hráč ho nepřevzal.`;
    else if (m?.status === 'ok' && !sameRegisteredName(m.data.fullName, `${p.surname} ${p.first_name}`))
      note = `Přiřazeno, ale LOK ${inst.lok_id} hráč nepřevzal: na chess.cz je pod jménem „${m.data.fullName}“. Rozhodněte u instance, komu LOK patří.`;
    else await db.prepare('UPDATE players SET lok_id = ? WHERE id = ?').bind(inst.lok_id, playerId).run();
  }
  await takeInstanceBirth(db, inst, playerId);
  await syncEntries(db, instanceId);
  await syncPlayerClub(db, playerId);
  if (inst.player_id !== playerId) await dropIfOrphan(db, inst.player_id);
  if (p.lok_id !== inst.lok_id) await dropOrphanLokHolder(db, inst.lok_id);
  else if (inst.lok_id) {
    // Assigned despite another name on chess.cz for the LOK = the operator accepted it (name change): no further warning.
    for (const s of (await seasonsOf(db, instanceId)).results)
      await db.prepare('INSERT OR IGNORE INTO issue_acks (season_id, issue_key, created_at) VALUES (?, ?, ?)').bind(s.season_id, `lok-name:${playerId}:${inst.lok_id}`, now()).run();
  }
  return note;
}

/** The instance is a different person: new player from it (confirmed). Possible-duplicate warnings against its candidates are dismissed. */
export async function newPlayerFromInstance(db: D1Database, instanceId: number): Promise<number> {
  const inst = await getInstance(db, instanceId);
  const e = await db
    .prepare('SELECT r.date FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = ? ORDER BY r.date LIMIT 1')
    .bind(instanceId)
    .first<{ date: string | null }>();
  const idx = await loadIndex(db);
  const cands = idx.candidates({ nameKey: inst.name_key, lokId: inst.lok_id, clubKey: inst.club_key }, inst.player_id);
  const pid = await createRoot(db, inst.cr_name, inst.lok_id, inst.club_raw, e?.date ?? null);
  await db.prepare("UPDATE player_instances SET player_id = ?, status = 'ok', how = 'manual', decided_at = ? WHERE id = ?").bind(pid, now(), instanceId).run();
  await takeInstanceBirth(db, inst, pid);
  await syncEntries(db, instanceId);
  await dropIfOrphan(db, inst.player_id);
  await dropOrphanLokHolder(db, inst.lok_id);
  const seasons = await seasonsOf(db, instanceId);
  for (const c of cands) {
    const ids = [c.playerId, pid].sort((a, b) => a - b).join(',');
    for (const s of seasons.results)
      for (const k of [`dup-name:${ids}`, `similar:${ids}`])
        await db.prepare('INSERT OR IGNORE INTO issue_acks (season_id, issue_key, created_at) VALUES (?, ?, ?)').bind(s.season_id, k, now()).run();
  }
  return pid;
}

export async function confirmInstances(db: D1Database, ids: number[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await db.prepare("UPDATE player_instances SET status = 'ok', decided_at = ? WHERE id = ? AND player_id IS NOT NULL AND status != 'ok'").bind(now(), id).run();
    n += r.meta.changes ?? 0;
  }
  return n;
}

/** Move all instances (and hand-assigned rows) of `sourceId` to `targetId`. */
export async function moveInstances(db: D1Database, sourceId: number, targetId: number) {
  await db.batch([
    db.prepare("UPDATE player_instances SET player_id = ?, status = 'ok', how = 'manual', decided_at = ? WHERE player_id = ?").bind(targetId, now(), sourceId),
    db.prepare('UPDATE entries SET player_id = ? WHERE player_id = ?').bind(targetId, sourceId),
  ]);
  await syncPlayerClub(db, targetId);
}

/**
 * Data from before instances existed (e.g. the 2025/26 seed): group rows by instance key, the instance belongs to the
 * player most of its rows had; rows assigned to someone else become row-level exceptions (match = 'manual').
 */
export async function backfillInstances(db: D1Database): Promise<number> {
  const rows = await db
    .prepare('SELECT id, cr_name, cr_lok_id, club_raw, player_id FROM entries WHERE instance_id IS NULL ORDER BY id')
    .all<{ id: number; cr_name: string; cr_lok_id: number | null; club_raw: string; player_id: number | null }>();
  if (!rows.results.length) return 0;
  const groups = new Map<string, { row: IdRow; crName: string; clubRaw: string; entries: typeof rows.results }>();
  for (const e of rows.results) {
    const row = rowIdentity(e.cr_name, e.cr_lok_id, e.club_raw);
    const k = instanceKey(row);
    (groups.get(k) ?? groups.set(k, { row, crName: e.cr_name, clubRaw: e.club_raw, entries: [] }).get(k)!).entries.push(e);
  }
  const stmts: D1PreparedStatement[] = [];
  for (const g of groups.values()) {
    let inst = await db
      .prepare('SELECT id, player_id FROM player_instances WHERE name_key = ? AND lok_key = ? AND club_key = ?')
      .bind(g.row.nameKey, g.row.lokId ?? 0, g.row.clubKey)
      .first<{ id: number; player_id: number | null }>();
    if (!inst) {
      const count = new Map<number, number>();
      for (const e of g.entries) if (e.player_id != null) count.set(e.player_id, (count.get(e.player_id) ?? 0) + 1);
      const pid = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const res = await db
        .prepare(
          `INSERT INTO player_instances (player_id, cr_name, name_key, lok_id, lok_key, club_raw, club_key, birth_year, birth_checked, status, how, reason, created_at, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT birth_year FROM players WHERE id = ?1 AND birth_source = 'cr'), 1, ?, 'legacy', 'Převedeno z dřívějšího přiřazení', ?, ?)`
        )
        .bind(pid, g.crName, g.row.nameKey, g.row.lokId, g.row.lokId ?? 0, g.clubRaw.trim(), g.row.clubKey, pid ? 'ok' : 'open', now(), now())
        .run();
      inst = { id: Number(res.meta.last_row_id), player_id: pid };
    }
    for (const e of g.entries)
      stmts.push(
        db.prepare('UPDATE entries SET instance_id = ?, match = ? WHERE id = ?').bind(inst.id, e.player_id != null && e.player_id !== inst.player_id ? 'manual' : null, e.id)
      );
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  // Rows of open instances without a player stay unassigned.
  return groups.size;
}

/**
 * Operator's verdict on the instance's LOK, which chess.cz registers under another name (see shared/lokcheck.ts).
 * Returns the player the instance went to, or null when it stays open (who the player is decided as usual).
 */
export async function decideLok(db: D1Database, instanceId: number, verdict: LokVerdict): Promise<{ playerId: number | null; message: string }> {
  const inst = await getInstance(db, instanceId);
  if (!inst.lok_id) fail(400, 'Instance nemá LOK');
  const m = await getMember(db, inst.lok_id);
  if (m.status !== 'ok') fail(409, `LOK ${inst.lok_id} není načtené z chess.cz`);
  const cz = m.data;
  await db
    .prepare('INSERT OR REPLACE INTO lok_verdicts (lok_id, verdict, cr_name, cz_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(inst.lok_id, verdict, inst.cr_name, cz.fullName, now())
    .run();
  await db.prepare('UPDATE player_instances SET reason = ? WHERE id = ?').bind(`${LOK_VERDICT[verdict]}: LOK ${inst.lok_id} je na chess.cz „${cz.fullName}“`, instanceId).run();
  const holder = await db.prepare('SELECT id FROM players WHERE lok_id = ?').bind(inst.lok_id).first<{ id: number }>();
  // The holder was created from this record and reopened (no instance or row of its own any more).
  const provisional =
    !!holder &&
    !(await db
      .prepare('SELECT (SELECT COUNT(*) FROM player_instances WHERE player_id = ?1) + (SELECT COUNT(*) FROM entries WHERE player_id = ?1) AS n')
      .bind(holder.id)
      .first<{ n: number }>())?.n;
  const others = async () => {
    const idx = await loadIndex(db);
    return idx.candidates({ nameKey: inst.name_key, lokId: null, clubKey: inst.club_key }).filter((c) => c.playerId !== holder?.id);
  };
  const stayOpen = async (reason: string) => {
    await db.prepare("UPDATE player_instances SET reason = ? WHERE id = ?").bind(reason, instanceId).run();
    return { playerId: null, message: reason };
  };

  if (verdict === 'cz') {
    const name = splitCzName(cz.fullName);
    let pid = holder?.id;
    if (!pid) {
      const e = await db
        .prepare('SELECT r.date FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id WHERE e.instance_id = ? ORDER BY r.date LIMIT 1')
        .bind(instanceId)
        .first<{ date: string | null }>();
      pid = await createRoot(db, inst.cr_name, inst.lok_id, inst.club_raw, e?.date ?? null, name);
    }
    // Name (and gender / birth year, by the caller) follow chess.cz.
    await db.prepare('UPDATE players SET surname = ?, first_name = ?, name_key = ? WHERE id = ?').bind(name.surname, name.firstName, nameKey(name.surname, name.firstName), pid).run();
    await assignInstance(db, instanceId, pid);
    return { playerId: pid, message: `Hráč veden jako ${cz.fullName} (LOK ${inst.lok_id})` };
  }

  if (verdict === 'cz-error') {
    if (holder) {
      // chess.cz name / gender / birth year of the wrong record are not used; the player keeps the LOK (Elo, registration).
      const h = await db.prepare('SELECT surname, gender_source, birth_source FROM players WHERE id = ?').bind(holder.id).first<{ surname: string; gender_source: string | null; birth_source: string | null }>();
      if (h?.gender_source === 'chesscz') await db.prepare("UPDATE players SET gender = ?, gender_source = 'guess' WHERE id = ?").bind(guessGender(h.surname), holder.id).run();
      if (h?.birth_source === 'chesscz') await db.prepare('UPDATE players SET birth_year = NULL, birth_source = NULL WHERE id = ?').bind(holder.id).run();
      await assignInstance(db, instanceId, holder.id);
      return { playerId: holder.id, message: `LOK ${inst.lok_id} ponecháno hráči z turnaje; chybné jméno na chess.cz nahlaste k opravě` };
    }
    if ((await others()).length) return stayOpen(`LOK ${inst.lok_id} patří hráči z turnaje (na chess.cz chybně „${cz.fullName}“) – vyberte, kdo to je`);
    return { playerId: await newPlayerFromInstance(db, instanceId), message: 'Založen nový hráč s tímto LOK' };
  }

  // bad-lok: the player is the one named in the tournament, without this LOK.
  if (holder && !provisional) return stayOpen(`LOK ${inst.lok_id} je v turnaji chybné – vyberte hráče, nebo Nový hráč`);
  if (!holder && (await others()).length) return stayOpen(`LOK ${inst.lok_id} je v turnaji chybné – vyberte hráče, nebo Nový hráč`);
  return { playerId: await newPlayerFromInstance(db, instanceId), message: 'Založen nový hráč bez LOK' };
}

/**
 * Open instances of a season whose every candidate is ruled out become a new player like an instance with nobody
 * similar ("auto", to be checked). A candidate is ruled out when it plays in the same round (one tournament per round),
 * or when it is likely a sibling: another first name and another birth year (both known; the same first name with
 * another year stays open – a mistyped year is possible). Run after each import (the other tournament of the round may
 * come later) and after the birth years were read from the player cards.
 */
export async function resolveRuledOut(db: D1Database, seasonId: number): Promise<number> {
  const open = await db
    .prepare(
      `SELECT * FROM player_instances WHERE status = 'open' AND player_id IS NULL
         AND id IN (SELECT e.instance_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?)`
    )
    .bind(seasonId)
    .all<InstanceRow>();
  if (!open.results.length) return 0;
  const rows = await db
    .prepare(
      `SELECT e.instance_id, e.player_id, t.round_id, r.ordinal, t.grp FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id
       WHERE t.season_id = ?`
    )
    .bind(seasonId)
    .all<{ instance_id: number | null; player_id: number | null; round_id: number; ordinal: number; grp: string }>();
  const byInst = new Map<number, Set<number>>();
  const byPlayer = new Map<number, Map<number, string>>();
  for (const r of rows.results) {
    if (r.instance_id != null) (byInst.get(r.instance_id) ?? byInst.set(r.instance_id, new Set()).get(r.instance_id)!).add(r.round_id);
    if (r.player_id != null) (byPlayer.get(r.player_id) ?? byPlayer.set(r.player_id, new Map()).get(r.player_id)!).set(r.round_id, `${r.ordinal}${r.grp}`);
  }
  const idx = await loadIndex(db);
  const players = new Map(
    (await db.prepare('SELECT id, surname, first_name, birth_year FROM players').all<{ id: number; surname: string; first_name: string; birth_year: number | null }>()).results.map((p) => [p.id, p])
  );
  // Another first name: no common word and not a typo (Filip × Filip James or Jakub × Jakb are the same person).
  const otherFirst = (a: string, b: string) => {
    const ta = fold(a).split(' ').filter(Boolean);
    const tb = fold(b).split(' ').filter(Boolean);
    return ta.length > 0 && tb.length > 0 && !ta.some((t) => tb.includes(t)) && !similarNames(ta.join(' '), tb.join(' '));
  };
  let n = 0;
  for (const i of open.results) {
    const ids = new Set(idx.candidates({ nameKey: i.name_key, lokId: i.lok_id, clubKey: i.club_key }).map((c) => c.playerId));
    if (i.lok_id) {
      const h = await db.prepare('SELECT id FROM players WHERE lok_id = ?').bind(i.lok_id).first<{ id: number }>();
      if (h) ids.add(h.id);
    }
    if (!ids.size) continue;
    const mine = byInst.get(i.id) ?? new Set<number>();
    const crFirst = splitCrName(i.cr_name).firstName;
    const why = [...ids].map((pid) => {
      const p = players.get(pid)!;
      const name = `${p.surname} ${p.first_name}`;
      const label = [...(byPlayer.get(pid) ?? new Map<number, string>())].find(([rid]) => mine.has(rid))?.[1];
      if (label) return `${name} hraje ve stejném kole (${label})`;
      if (i.birth_year && p.birth_year && i.birth_year !== p.birth_year && otherFirst(crFirst, p.first_name))
        return `${name} má jiné křestní jméno a rok narození ${p.birth_year} (sourozenec?)`;
      return null;
    });
    if (why.some((x) => x == null)) continue;
    await newPlayerFromInstance(db, i.id);
    await db
      .prepare("UPDATE player_instances SET status = 'auto', how = 'new', decided_at = NULL, reason = ? WHERE id = ?")
      .bind(`Nový hráč – ${why.join('; ')}`, i.id)
      .run();
    n++;
  }
  return n;
}
