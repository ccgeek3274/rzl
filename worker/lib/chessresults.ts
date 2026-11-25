// chess-results.com client. Pages are fetched with turdet=YES; the tournament details (linked tournaments)
// of tournaments older than two weeks are only shown after an ASP.NET postback of "cb_alleDetails".
import { needsDetailsPostback, postbackFields } from '../../shared/chessresults';
import { acquire, block } from './gate';
import { fail } from './http';

const BASE = 'https://chess-results.com';
const UA = 'Mozilla/5.0 (compatible; rzl-evidence/0.1)';
const TIMEOUT_MS = 20_000;

async function crFetch(db: D1Database, url: string, init?: RequestInit): Promise<{ html: string; url: string }> {
  if (!(await acquire(db, 'chessresults'))) fail(429, 'chess-results.com: probíhá jiné načítání, zkuste to za chvíli');
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'follow', headers: { 'User-Agent': UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    await block(db, 'chessresults', 60_000);
    fail(503, `chess-results.com neodpovídá (${(e as Error).name})`);
  }
  if (!res.ok) fail(502, `chess-results.com vrátil chybu ${res.status}`);
  return { html: await res.text(), url: res.url };
}

export function pageUrl(tnr: number, art: number, extra = ''): string {
  return `${BASE}/tnr${tnr}.aspx?lan=5&art=${art}&turdet=YES${extra}`;
}

export async function fetchPage(db: D1Database, tnr: number, art: number, extra = ''): Promise<string> {
  return (await crFetch(db, pageUrl(tnr, art, extra))).html;
}

/** Tournament page with details (linked tournaments, dates) — does the postback when needed. */
export async function fetchDetails(db: D1Database, tnr: number): Promise<string> {
  const first = await crFetch(db, `${BASE}/tnr${tnr}.aspx?lan=5&turdet=YES`);
  if (!needsDetailsPostback(first.html)) return first.html;
  const body = new URLSearchParams(postbackFields(first.html)).toString();
  const second = await crFetch(db, first.url, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return second.html;
}
