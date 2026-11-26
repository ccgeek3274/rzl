// History of the operator's decisions (decision_log), shown on Kontrola → Historie.
import { now } from './http';

export type LogKind = 'pairing' | 'lok' | 'gender' | 'entry' | 'ack' | 'club' | 'player' | 'merge';

export type LogEntry = {
  seasonId?: number | null;
  kind: LogKind;
  title: string;
  detail?: string | null;
  playerId?: number | null;
  tournamentId?: number | null;
  instanceId?: number | null;
};

export async function logDecision(db: D1Database, e: LogEntry): Promise<void> {
  await db
    .prepare('INSERT INTO decision_log (season_id, at, kind, title, detail, player_id, tournament_id, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(e.seasonId ?? null, now(), e.kind, e.title, e.detail ?? null, e.playerId ?? null, e.tournamentId ?? null, e.instanceId ?? null)
    .run();
}

/** Season of an instance's rows (latest), of a player's rows, of a tournament. */
export async function seasonOfInstance(db: D1Database, instanceId: number): Promise<number | null> {
  return (
    (await db.prepare('SELECT MAX(t.season_id) AS s FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.instance_id = ?').bind(instanceId).first<{ s: number | null }>())?.s ??
    null
  );
}
export async function seasonOfPlayer(db: D1Database, playerId: number): Promise<number | null> {
  return (
    (await db.prepare('SELECT MAX(t.season_id) AS s FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.player_id = ?').bind(playerId).first<{ s: number | null }>())?.s ?? null
  );
}

/** "Novák Petr (R0012)" */
export async function playerLabel(db: D1Database, playerId: number | null | undefined): Promise<string> {
  if (!playerId) return '–';
  const p = await db.prepare('SELECT surname, first_name FROM players WHERE id = ?').bind(playerId).first<{ surname: string; first_name: string }>();
  return p ? `${p.surname} ${p.first_name} (R${String(playerId).padStart(4, '0')})` : `R${String(playerId).padStart(4, '0')}`;
}

export const crLabel = (crName: string) => crName.replace(/,/g, '').replace(/\s+/g, ' ').trim();
