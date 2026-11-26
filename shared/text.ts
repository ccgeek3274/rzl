// Text helpers shared by worker + web (no DOM / Workers APIs).

/** Lowercase, strip diacritics, collapse whitespace. "Žlutý  Kůň" -> "zluty kun". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matching key for a person: folded "surname first", comma-insensitive. */
export function nameKey(surname: string, firstName: string): string {
  return fold(`${surname} ${firstName}`.replace(/,/g, ' '));
}

/** chess-results writes "Surname, First Middle" (sometimes with trailing spaces). */
export function splitCrName(raw: string): { surname: string; firstName: string } {
  const s = raw.replace(/\s+/g, ' ').trim();
  const i = s.indexOf(',');
  if (i >= 0) return { surname: s.slice(0, i).trim(), firstName: s.slice(i + 1).trim() };
  // Crosstable variant "Surname First" — best effort: first word is the surname.
  const j = s.indexOf(' ');
  return j < 0 ? { surname: s, firstName: '' } : { surname: s.slice(0, j), firstName: s.slice(j + 1) };
}

/** Czech surname heuristic for players without registration: -ová / -á => female. */
export function guessGender(surname: string): 'M' | 'F' {
  return /á$/i.test(surname.trim()) ? 'F' : 'M';
}

/** "3,5" -> 3.5 */
export function parseNum(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.replace(',', '.').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 3.5 -> "3,5" (Czech decimal comma). */
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Own stable player identifier shown in the UI ("R0079"); players.id is AUTOINCREMENT, never reused. */
export const rzlId = (id: number) => `R${String(id).padStart(4, '0')}`;

/** Instance identifier ("I0412"): one way a player appears in tournaments, see shared/identity.ts. */
export const instId = (id: number) => `I${String(id).padStart(4, '0')}`;

/** Matches "R79", "r0079", "79" typed into a search box against a player id. */
export function matchesRzlId(q: string, id: number): boolean {
  const m = q.trim().match(/^r?0*(\d+)$/i);
  return !!m && Number(m[1]) === id;
}

/** How two folded name keys relate: identical, swapped word order, small typo, or one extends the other ("novak jan" / "novak jan petr"). */
export function similarNames(a: string, b: string): 'same' | 'swap' | 'typo' | 'subset' | null {
  if (a === b) return 'same';
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  const sa = ta.slice().sort().join(' ');
  const sb = tb.slice().sort().join(' ');
  if (sa === sb) return 'swap';
  const max = Math.min(a.length, b.length) >= 10 ? 2 : 1;
  if (levenshtein(a, b, max) <= max || levenshtein(sa, sb, max) <= max) return 'typo';
  const [short, long] = ta.length < tb.length ? [ta, tb] : [tb, ta];
  if (short.length >= 2 && short.length < long.length && short.every((t) => long.includes(t))) return 'subset';
  return null;
}

/** Could the name registered on chess.cz ("Surname First") be the same person as `name`? Order, typo, extra name, hyphens allowed. */
export function sameRegisteredName(a: string, b: string): boolean {
  const k = (x: string) =>
    fold(x)
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
  const [ka, kb] = [k(a), k(b)];
  return similarNames(ka, kb) != null || ka.replace(/ /g, '') === kb.replace(/ /g, '');
}

/** Levenshtein distance, early exit once it exceeds `max` (returns max + 1). */
function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
