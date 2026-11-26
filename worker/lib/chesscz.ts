// chess.cz API (member detail) with D1 cache and the shared rate gate (~3 req/s max; bursts get the IP blocked for hours).
import { acquire, block } from './gate';

const BASE = 'https://api.chess.cz/api';
const TTL_MS = 7 * 24 * 3600 * 1000;

export type ChessczMember = {
  fullName: string;
  gender: 'M' | 'F';
  birthYear: number | null;
  czeId: number;
  czeStdElo: number;
  czeRapidElo: number;
  fideId: number;
  fideStdElo: number;
  fideRapidElo: number;
  fideBlitzElo: number;
  clubName: string | null;
  clubId: string | null;
  registration: string;
};

export type MemberResult = { status: 'ok'; data: ChessczMember } | { status: 'notfound' } | { status: 'unavailable'; error: string };

/** chess.cz returns "M" / "Ž" (žena); normalize to M | F. */
export function normGender(g: string | null | undefined): 'M' | 'F' {
  return g && /^[ŽZFzžf]/.test(g.trim()) ? 'F' : 'M';
}

export async function getMember(db: D1Database, lokId: number, force = false): Promise<MemberResult> {
  const key = `/members/${lokId}/cze`;
  const cached = await db.prepare('SELECT payload, fetched_at FROM chesscz_cache WHERE cache_key = ?').bind(key).first<{ payload: string; fetched_at: number }>();
  if (cached && !force && Date.now() - cached.fetched_at < TTL_MS) {
    const data = JSON.parse(cached.payload) as ChessczMember | null;
    return data ? { status: 'ok', data: { ...data, gender: normGender(data.gender) } } : { status: 'notfound' };
  }
  if (!(await acquire(db, 'chesscz'))) return { status: 'unavailable', error: 'chess.cz: zkuste to za chvíli' };
  let res: Response;
  try {
    res = await fetch(BASE + key, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    await block(db, 'chesscz', 10 * 60_000);
    return { status: 'unavailable', error: 'chess.cz neodpovídá' };
  }
  let data: ChessczMember | null = null;
  if (res.status === 404) data = null;
  else if (!res.ok) return { status: 'unavailable', error: `chess.cz chyba ${res.status}` };
  else {
    const j = (await res.json()) as ChessczMember | null;
    data = j && j.czeId ? { ...j, fullName: j.fullName.trim(), gender: normGender(j.gender) } : null;
  }
  await db
    .prepare('INSERT INTO chesscz_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at')
    .bind(key, JSON.stringify(data), Date.now())
    .run();
  return data ? { status: 'ok', data } : { status: 'notfound' };
}

/** Elo fields of a club member list entry (the list has no gender / club fields). */
export type ChessczClubMember = Omit<ChessczMember, 'gender' | 'clubName' | 'clubId'>;

/** All members of a club in one request (always fresh: used by the Elo refresh). null = chess.cz unavailable. */
export async function getClubMembers(db: D1Database, code: string): Promise<ChessczClubMember[] | null> {
  if (!(await acquire(db, 'chesscz'))) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/clubs/${encodeURIComponent(code)}/members`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    await block(db, 'chesscz', 10 * 60_000);
    return null;
  }
  if (res.status === 404) return [];
  if (!res.ok) return null;
  const j = (await res.json()) as ChessczClubMember[] | null;
  const list = Array.isArray(j) ? j.filter((m) => m && m.czeId).map((m) => ({ ...m, fullName: m.fullName.trim() })) : [];
  await db
    .prepare('INSERT OR REPLACE INTO chesscz_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)')
    .bind(`/clubs/${code}/members`, JSON.stringify(list.map((m) => ({ czeId: m.czeId, fullName: m.fullName, birthYear: m.birthYear }))), Date.now())
    .run();
  return list;
}

/** Member detail from the cache only (no request); null = not loaded or not found. */
export async function cachedMember(db: D1Database, lokId: number): Promise<ChessczMember | null> {
  const r = await db.prepare('SELECT payload FROM chesscz_cache WHERE cache_key = ?').bind(`/members/${lokId}/cze`).first<{ payload: string }>();
  const d = r ? (JSON.parse(r.payload) as ChessczMember | null) : null;
  return d ? { ...d, gender: normGender(d.gender) } : null;
}

/** Club member list (LOK, name, birth year) from the cache only; null = not loaded. */
export async function cachedClub(db: D1Database, code: string): Promise<{ czeId: number; fullName: string; birthYear: number | null }[] | null> {
  const r = await db.prepare('SELECT payload FROM chesscz_cache WHERE cache_key = ?').bind(`/clubs/${code}/members`).first<{ payload: string }>();
  return r ? JSON.parse(r.payload) : null;
}
