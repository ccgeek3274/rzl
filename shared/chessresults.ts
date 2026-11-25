// Parsers for chess-results.com HTML pages (Swiss-Manager uploads). Pure string parsing, no DOM,
// so it runs in the Worker and in vitest alike. Verified on RŽL 2025/26 + 2026/27 pages.
//
// Pages used (always with &lan=5&turdet=YES):
//   art=0  start list           -> snr, name, LOK ID, Rtg, club
//   art=5  crosstable by snr    -> per-round games (opponent snr, colour, result), points, rank
//   art=9  player info (snr=)   -> birth year (only needed for players without LOK ID)
//   tournament details (postback "cb_alleDetails") -> linked tournaments ("Výběr turnaje")

import { parseNum } from './text';

export type CrGame =
  | { kind: 'game'; opp: number; color: 'w' | 'b'; score: 0 | 0.5 | 1 }
  | { kind: 'forfeit'; opp: number; color: 'w' | 'b'; score: 0 | 1 }
  | { kind: 'bye'; score: 0 | 0.5 | 1 } // "-1" (pairing-allocated bye / free point), "-0" (absent)
  | { kind: 'none' };

export type CrPlayer = {
  snr: number;
  name: string; // "Surname, First" (promotion note removed, see `mark`)
  mark: string | null; // "A" when the organizer left "do A" (promoted to group A) after the name
  lokId: number | null; // null when ID is empty or 0
  rtg: number | null;
  club: string;
  points: number;
  rank: number;
  games: CrGame[];
};

export type CrTournament = {
  title: string;
  lastUpdate: string | null; // "20.09.2025 14:19:18" as shown on the page
  rounds: number;
  players: CrPlayer[];
};

export type CrLinked = { tnr: number | null; name: string; current: boolean };

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½' };
// Latin-1 named entities (&ouml; &eacute; …) — chess-results uses them for foreign names.
const LATIN1 = 'iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
LATIN1.split(' ').forEach((n, i) => (ENTITY[n] = String.fromCharCode(161 + i)));

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => ENTITY[n] ?? ENTITY[n.toLowerCase()] ?? m);
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, '')).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Rows of the main result table (class="CRs1"); the page has nested layout tables we must skip. */
function mainTableRows(html: string): string[][] {
  const m = html.match(/<table class="CRs1"[\s\S]*?<\/table>/);
  if (!m) return [];
  const rows: string[][] = [];
  for (const tr of m[0].match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    rows.push((tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map((c) => stripTags(c)));
  }
  return rows;
}

function tableObjects(html: string): Record<string, string>[] {
  const rows = mainTableRows(html);
  const hi = rows.findIndex((r) => r[0] === 'Čís.' || r[0] === 'Poř.');
  if (hi < 0) return [];
  const hdr = rows[hi];
  return rows
    .slice(hi + 1)
    .filter((r) => /^\d+$/.test(r[0] ?? ''))
    .map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ''])));
}

export function parseTitle(html: string): string {
  const m = html.match(/<h2>([\s\S]*?)<\/h2>/);
  return m ? stripTags(m[1]) : '';
}

export function parseLastUpdate(html: string): string | null {
  const m = stripTags(html).match(/Poslední aktualizace\s*(\d{1,2}\.\d{1,2}\.\d{4} \d{1,2}:\d{2}(?::\d{2})?)/);
  return m ? m[1] : null;
}

export function parseGame(cell: string): CrGame {
  const c = cell.trim();
  let m = c.match(/^(\d+)([wbs])([01½])$/);
  if (m) {
    const score = m[3] === '½' ? 0.5 : (Number(m[3]) as 0 | 1);
    return { kind: 'game', opp: Number(m[1]), color: m[2] === 'b' ? 'b' : 'w', score };
  }
  m = c.match(/^(\d+)([wbs])([+-])$/);
  if (m) return { kind: 'forfeit', opp: Number(m[1]), color: m[2] === 'b' ? 'b' : 'w', score: m[3] === '+' ? 1 : 0 };
  m = c.match(/^-([01½])$/);
  if (m) return { kind: 'bye', score: m[1] === '½' ? 0.5 : (Number(m[1]) as 0 | 1) };
  return { kind: 'none' };
}

/** Start list (art=0): snr -> identity columns. */
export function parseStartList(html: string): Map<number, { name: string; lokId: number | null; rtg: number | null; club: string }> {
  const out = new Map<number, { name: string; lokId: number | null; rtg: number | null; club: string }>();
  for (const o of tableObjects(html)) {
    const snr = Number(o['Čís.']);
    const id = Number(o['ID'] || 0);
    const rtg = Number(o['Rtg'] || 0);
    out.set(snr, { name: o['Jméno'], lokId: id > 0 ? id : null, rtg: rtg > 0 ? rtg : null, club: o['Klub/Místo'] ?? '' });
  }
  return out;
}

/** Organizer's promotion note left in the name: "Novák, Petr do A". */
const MARK_RE = /\s+do\s+([ABC])\.?\s*$/i;

export function splitMark(rawName: string): { name: string; mark: string | null } {
  const m = rawName.match(MARK_RE);
  return m ? { name: rawName.slice(0, m.index).trim(), mark: m[1].toUpperCase() } : { name: rawName.trim(), mark: null };
}

/** Crosstable by start number (art=5) joined with the start list (art=0). */
export function parseTournament(startHtml: string, crossHtml: string): CrTournament {
  const start = parseStartList(startHtml);
  const objs = tableObjects(crossHtml);
  let rounds = 0;
  const players: CrPlayer[] = objs.map((o) => {
    const snr = Number(o['Čís.']);
    const st = start.get(snr);
    const roundKeys = Object.keys(o).filter((k) => /^\d+\.Rd$/.test(k));
    rounds = Math.max(rounds, roundKeys.length);
    const rtgX = Number(o['Rtg'] || 0);
    const { name, mark } = splitMark(st?.name ?? o['Jméno']);
    return {
      snr,
      name,
      mark,
      lokId: st?.lokId ?? null,
      rtg: st?.rtg ?? (rtgX > 0 ? rtgX : null),
      club: st?.club ?? '',
      points: parseNum(o['Body']) ?? 0,
      rank: Number(o['Poř.']),
      games: roundKeys.map((k) => parseGame(o[k])),
    };
  });
  return { title: parseTitle(crossHtml) || parseTitle(startHtml), lastUpdate: parseLastUpdate(crossHtml), rounds, players };
}

/** Player info page (art=9): birth year. */
export function parsePlayerInfo(html: string): { birthYear: number | null; name: string | null; lokId: number | null } {
  const text = stripTags(html.replace(/<\/t[dh]>/g, ' | ').replace(/<\/tr>/g, '\n'));
  const by = text.match(/Rok narození \| (\d{4})/);
  const nm = text.match(/Jméno \| ([^|]+)\|/);
  const id = text.match(/Ident-číslo \| (\d+)/);
  return { birthYear: by ? Number(by[1]) : null, name: nm ? nm[1].trim() : null, lokId: id && Number(id[1]) > 0 ? Number(id[1]) : null };
}

/** Does the page show only the "zobrazit detaily o turnaji" button (old tournament, details hidden)? */
export function needsDetailsPostback(html: string): boolean {
  return html.includes('name="cb_alleDetails"');
}

/** ASP.NET hidden form fields needed to submit the details postback. */
export function postbackFields(html: string): Record<string, string> {
  const f: Record<string, string> = {};
  for (const name of ['__EVENTTARGET', '__EVENTARGUMENT', '__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    const m = html.match(new RegExp(`name="${name}" id="${name}" value="([^"]*)"`));
    f[name] = m ? decodeHtml(m[1]) : '';
  }
  f['cb_alleDetails'] = 'zobrazit detaily o turnaji';
  return f;
}

/** Linked tournaments from the details view ("Výběr turnaje"). The current one is bold, others are links. */
export function parseLinked(html: string, currentTnr: number): CrLinked[] {
  const m = html.match(/Výb(?:&#283;|ě)r turnaje<\/td><td[^>]*>([\s\S]*?)<\/td>/);
  if (!m) return [];
  const out: CrLinked[] = [];
  const re = /<a [^>]*href="[^"]*tnr(\d+)\.aspx[^"]*"[^>]*>([\s\S]*?)<\/a>|<b>([\s\S]*?)<\/b>/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(m[1]))) {
    if (x[1]) out.push({ tnr: Number(x[1]), name: stripTags(x[2]), current: false });
    else out.push({ tnr: currentTnr, name: stripTags(x[3]), current: true });
  }
  return out;
}

/** "Pravonin B" -> { place: "Pravonin", group: "B" } */
export function splitLinkedName(name: string): { place: string; group: string | null } {
  const m = name.trim().match(/^(.*?)[\s-]+([A-Z])$/);
  return m ? { place: m[1].trim(), group: m[2] } : { place: name.trim(), group: null };
}

/** Facts from a title like "2. turnaj Regionální žákovské ligy 2026/27 - region SE Benešov Pravonín - 17.10.2026 - turnaj B". */
export function parseTitleFacts(title: string): { roundNo: number | null; date: string | null; group: string | null; season: string | null } {
  const rn = title.match(/^(\d+)\.\s*turnaj/i);
  const d = title.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const g = title.match(/turnaj\s+([A-Z])\s*$/);
  const s = title.match(/(\d{4}\/\d{2,4})/);
  return {
    roundNo: rn ? Number(rn[1]) : null,
    date: d ? `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}` : null,
    group: g ? g[1] : null,
    season: s ? s[1] : null,
  };
}

/** Place with diacritics from the title when it matches the ASCII link name ("Tynec" -> "Týnec nad Sázavou"). */
export function placeFromTitle(title: string, asciiPlace: string): string {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const beforeDate = title.split(/\s-?\s*\d{1,2}\.\d{1,2}\.\d{4}/)[0];
  const words = beforeDate.split(/\s+/);
  const target = fold(asciiPlace).replace(/\s+/g, '');
  for (let i = 0; i < words.length; i++) {
    if (fold(words[i]).startsWith(fold(asciiPlace.split(/[\s.]/)[0])) && fold(words[i]).length > 2) {
      const cand = words.slice(i).join(' ').replace(/\s*-\s*$/, '');
      if (fold(cand).replace(/\s+/g, '').startsWith(target.slice(0, 4))) return cand;
    }
  }
  return asciiPlace;
}
