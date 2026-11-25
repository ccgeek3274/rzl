// Global outbound rate gate kept in D1 (one row per upstream). Both chess.cz and chess-results
// punish bursts, so every upstream request must pass through here.

export type GateId = 'chesscz' | 'chessresults';

const MIN_GAP_MS: Record<GateId, number> = { chesscz: 350, chessresults: 1000 };
const MAX_WAIT_MS = 15_000;

/** Wait for a free slot; returns false when blocked or the wait would be too long. */
export async function acquire(db: D1Database, id: GateId): Promise<boolean> {
  const started = Date.now();
  while (true) {
    const now = Date.now();
    const row = await db.prepare('SELECT last_fetch_at, blocked_until FROM rate_gate WHERE id = ?').bind(id).first<{ last_fetch_at: number; blocked_until: number }>();
    if (!row) return true;
    if (row.blocked_until > now) return false;
    const res = await db
      .prepare('UPDATE rate_gate SET last_fetch_at = ? WHERE id = ? AND last_fetch_at <= ?')
      .bind(now, id, now - MIN_GAP_MS[id])
      .run();
    if ((res.meta?.changes ?? 0) > 0) return true;
    const wait = row.last_fetch_at + MIN_GAP_MS[id] - Date.now() + 20;
    if (Date.now() - started + wait > MAX_WAIT_MS) return false;
    await new Promise((r) => setTimeout(r, Math.max(wait, 20)));
  }
}

export async function block(db: D1Database, id: GateId, ms: number): Promise<void> {
  await db.prepare('UPDATE rate_gate SET blocked_until = ? WHERE id = ?').bind(Date.now() + ms, id).run();
}
