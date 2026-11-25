// DB side of instance-based identification (logic in shared/identity.ts).
import { IdentityIndex, instanceKey, rowIdentity, type IdRow, type InstanceHow, type InstanceStatus } from '../../shared/identity';
import { guessGender, nameKey, splitCrName } from '../../shared/text';
import { clubFor } from './importer';
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

/** New player (root) from a tournament row; the LOK is taken only when no other player has it. */
export async function createRoot(db: D1Database, crName: string, lokId: number | null, clubRaw: string, date: string | null): Promise<number> {
  const { surname, firstName } = splitCrName(crName);
  const clubId = await clubFor(db, clubRaw);
  const lok = (await lokFree(db, lokId)) ? lokId : null;
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
 * Operator assigns an instance to a player (confirmed). A player without LOK takes the instance's LOK when nobody
 * else has it (registration during the season); a wrong LOK is then reported by the chess.cz name check.
 */
export async function assignInstance(db: D1Database, instanceId: number, playerId: number): Promise<void> {
  const inst = await getInstance(db, instanceId);
  const p = await db.prepare('SELECT id, lok_id FROM players WHERE id = ?').bind(playerId).first<{ id: number; lok_id: number | null }>();
  if (!p) fail(404, 'Hráč nenalezen');
  await db
    .prepare("UPDATE player_instances SET player_id = ?, status = 'ok', how = CASE WHEN player_id IS ? THEN how ELSE 'manual' END, decided_at = ? WHERE id = ?")
    .bind(playerId, playerId, now(), instanceId)
    .run();
  if (!p.lok_id && inst.lok_id && (await lokFree(db, inst.lok_id))) await db.prepare('UPDATE players SET lok_id = ? WHERE id = ?').bind(inst.lok_id, playerId).run();
  await syncEntries(db, instanceId);
  if (inst.player_id !== playerId) await dropIfOrphan(db, inst.player_id);
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
  await syncEntries(db, instanceId);
  await dropIfOrphan(db, inst.player_id);
  const seasons = await db.prepare('SELECT DISTINCT t.season_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.instance_id = ?').bind(instanceId).all<{ season_id: number }>();
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
