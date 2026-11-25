import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeHtml,
  parseGame,
  parseLinked,
  parsePlayerInfo,
  parseTitleFacts,
  parseTournament,
  needsDetailsPostback,
  placeFromTitle,
  splitLinkedName,
} from '../chessresults';
import { categoryOf, computeElo, computeStandings, DEFAULT_SETTINGS, type StEntry, type StPlayer } from '../rzl';
import { nameKey, splitCrName } from '../text';

const FX = join(__dirname, 'fixtures');
// Stored chess-results pages and the official sheet contain players' personal data: kept out of the public repo.
const HAS_FX = existsSync(FX);
const read = (f: string) => readFileSync(join(FX, f), 'utf-8');
const tour = (tnr: number) => parseTournament(read(`${tnr}_0.html`), read(`${tnr}_5.html`));

// 2026/27 rounds 1–3 (Sedlčany, Pravonín, Říčany), groups A, B, C.
const SEASON_26 = [
  [1492587, 1495424, 1495430],
  [1517087, 1520610, 1520612],
  [1538169, 1543906, 1543911],
];
const OUT_OF_REGION = /OAZA Praha|Neratovice|Polabí/i;

describe('chess-results parser', () => {
  it('decodes entities', () => {
    expect(decodeHtml('M&uuml;llerov&aacute; &#268;&Uuml; 1&frac12;')).toBe('Müllerová ČÜ 1½');
  });

  it('parses games', () => {
    expect(parseGame('12b½')).toEqual({ kind: 'game', opp: 12, color: 'b', score: 0.5 });
    expect(parseGame('3w1')).toEqual({ kind: 'game', opp: 3, color: 'w', score: 1 });
    expect(parseGame('-1')).toEqual({ kind: 'bye', score: 1 });
    expect(parseGame('-0')).toEqual({ kind: 'bye', score: 0 });
    expect(parseGame('7b+')).toEqual({ kind: 'forfeit', opp: 7, color: 'b', score: 1 });
  });

  it.skipIf(!HAS_FX)('joins start list and crosstable', () => {
    const t = tour(1492587);
    expect(t.title).toContain('turnaj A');
    expect(t.rounds).toBe(4);
    expect(t.players).toHaveLength(16);
    const winner = t.players.find((p) => p.rank === 1)!;
    expect(winner).toMatchObject({ rtg: 1589, points: 3.5 });
    expect(winner.games).toHaveLength(4);
    expect(tour(1543911).players.some((p) => p.lokId === null)).toBe(true);
  });

  it.skipIf(!HAS_FX)('parses linked tournaments from details view', () => {
    const l = parseLinked(read('1250588_det.html'), 1250588);
    expect(l).toHaveLength(27);
    expect(l[0]).toEqual({ tnr: 1250588, name: 'Sedlcany A', current: true });
    expect(l.find((x) => x.name === 'Chocerady A')!.tnr).toBe(1444579);
    expect(needsDetailsPostback(read('1250588_nodet.html'))).toBe(true);
    expect(splitLinkedName('St.Skalice B')).toEqual({ place: 'St.Skalice', group: 'B' });
  });

  it('parses title facts', () => {
    const f = parseTitleFacts('2. turnaj Regionální žákovské ligy 2026/27 - region SE Benešov Pravonín - 17.10.2026 - turnaj B');
    expect(f).toEqual({ roundNo: 2, date: '2026-10-17', group: 'B', season: '2026/27' });
    expect(placeFromTitle('6. turnaj Regionální žákovské ligy 2025/26 - region SE Benešov Týnec nad Sázavou 7.2.2026 - turnaj A', 'Tynec')).toBe(
      'Týnec nad Sázavou'
    );
    expect(placeFromTitle('2. turnaj RŽL 2026/27 - region SE Benešov Pravonín - 17.10.2026 - turnaj B', 'Pravonin')).toBe('Pravonín');
  });

  it('parses player info', () => {
    const html = '<table><tr><td>Jméno</td><td>Novák, Petr</td></tr><tr><td>Ident-číslo</td><td>99001</td></tr><tr><td>Rok narození</td><td>2012</td></tr></table>';
    expect(parsePlayerInfo(html)).toEqual({ birthYear: 2012, name: 'Novák, Petr', lokId: 99001 });
  });
});

describe('categories', () => {
  it('matches official sheets', () => {
    expect(categoryOf(2011, 2026)).toBe('J');
    expect(categoryOf(2012, 2026)).toBe('16');
    expect(categoryOf(2015, 2026)).toBe('14');
    expect(categoryOf(2017, 2026)).toBe('12');
    expect(categoryOf(2018, 2026)).toBe('10');
    expect(categoryOf(2009, 2024)).toBe('J');
    expect(categoryOf(2014, 2024)).toBe('12');
    expect(categoryOf(2019, 2025)).toBe('10');
    expect(categoryOf(2019, 2025, true)).toBe('8');
    expect(categoryOf(2018, 2025, true)).toBe('10');
  });
});

/** Official 2026/27 sheet: name -> { total, placementSum, elo }. */
function officialSheet() {
  const out = new Map<string, { total: number; placementSum: number; elo: number }>();
  for (const line of read('RZL_26_27.txt').split('\n')) {
    const m = line.match(/^\s*\d+\s+(\S+(?: \S+)+?)\s{2,}(?:H8|D8)?\s*(\d{3,4})\b.*?\s(\d{2})\s+(J|\d{1,2})\s+(\d)\s+([\d,]+)\s+(\d+)\s/);
    if (!m) continue;
    out.set(m[1].toLowerCase(), { elo: Number(m[2]), total: Number(m[6].replace(',', '.')), placementSum: Number(m[7]) });
  }
  return out;
}

describe.skipIf(!HAS_FX)('RŽL 2026/27 rounds 1–3 vs official sheet', () => {
  // Identity: LOK ID, otherwise name (as the app does before manual review).
  const ids = new Map<string, number>();
  const idOf = (lok: number | null, name: string) => {
    // The official sheet identifies players by name (its LOK IDs contain typos), so do we here.
    void lok;
    const k = nameKey(splitCrName(name).surname, splitCrName(name).firstName);
    return ids.get(k) ?? ids.set(k, ids.size + 1).get(k)!;
  };
  const names = new Map<number, string>();
  const sheet = HAS_FX ? officialSheet() : new Map<string, { total: number; placementSum: number; elo: number }>();
  const players = new Map<number, StPlayer>();
  const rounds = SEASON_26.map((_, i) => ({ id: i + 1, ordinal: i + 1, place: '', date: null }));
  const tournaments: { id: number; roundId: number; group: string }[] = [];
  const entries: StEntry[] = [];
  const eloInput: Parameters<typeof computeElo>[0] = [];
  let eid = 0;
  (HAS_FX ? SEASON_26 : []).forEach((tnrs, ri) =>
    tnrs.forEach((tnr, gi) => {
      const t = tour(tnr);
      tournaments.push({ id: tnr, roundId: ri + 1, group: 'ABC'[gi] });
      const ep: (typeof eloInput)[0]['players'] = [];
      for (const p of t.players) {
        const pid = idOf(p.lokId, p.name);
        const { surname, firstName } = splitCrName(p.name);
        names.set(pid, `${surname} ${firstName}`.toLowerCase());
        // Region membership is a manual decision in the app; here we take it from the sheet itself.
        const eligible = !OUT_OF_REGION.test(p.club) && (p.lokId != null || sheet.has(names.get(pid)!));
        players.set(pid, { id: pid, eligible: eligible || !!players.get(pid)?.eligible, birthYear: null });
        entries.push({ id: ++eid, tournamentId: tnr, playerId: pid, rank: p.rank, points: p.points, excluded: false });
        ep.push({ snr: p.snr, playerId: pid, rtg: p.rtg, games: p.games });
      }
      eloInput.push({ id: tnr, date: `2026-0${ri + 1}`, order: gi, players: ep });
    })
  );
  const rows = computeStandings(rounds, tournaments, entries, players, DEFAULT_SETTINGS);

  it('reads the official sheet', () => expect(sheet.size).toBeGreaterThan(120));

  it('reproduces totals and placement sums', () => {
    let checked = 0;
    const bad: string[] = [];
    for (const r of rows) {
      const o = sheet.get(names.get(r.playerId)!);
      if (!o) continue;
      checked++;
      if (o.total !== r.total) bad.push(`${names.get(r.playerId)} total ${r.total} vs ${o.total}`);
      // The sheet's placements are typed by hand and contain slips (e.g. Říčany C rank 35 -> 101, rank 37 -> 99).
      if (Math.abs(o.placementSum - r.placementSum) > 7) bad.push(`${names.get(r.playerId)} placement ${r.placementSum} vs ${o.placementSum}`);
    }
    expect(checked).toBeGreaterThan(120);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('reproduces RŽL Elo for nearly all players', () => {
    const hist = computeElo(eloInput, DEFAULT_SETTINGS);
    let ok = 0;
    let n = 0;
    const dbg: string[] = [];
    for (const [pid, steps] of hist) {
      const o = sheet.get(names.get(pid)!);
      if (!o) continue;
      n++;
      if (Math.abs(steps[steps.length - 1].after - o.elo) <= 1) ok++;
      else dbg.push(`${names.get(pid)}: ${steps[steps.length - 1].after} vs ${o.elo}`);
    }
    expect(ok / n, dbg.join('\n')).toBeGreaterThan(0.9);
  });
});

import { matchesRzlId, rzlId, similarNames } from '../text';

describe('player identity', () => {
  it('detects similar names', () => {
    expect(similarNames('tran bao minh', 'tren bao minh')).toBe('typo');
    expect(similarNames('tran gia bao', 'gia bao tran')).toBe('swap');
    expect(similarNames('novak jan', 'novak jan petr')).toBe('subset');
    expect(similarNames('novakova eliska', 'novakova eliska')).toBe('same');
    expect(similarNames('novak jan', 'novy petr')).toBeNull();
    expect(similarNames('dvorak jindrich', 'dvorak jindra')).toBeNull();
  });
  it('formats and matches RŽL ID', () => {
    expect(rzlId(79)).toBe('R0079');
    expect(matchesRzlId('R0079', 79)).toBe(true);
    expect(matchesRzlId('r79', 79)).toBe(true);
    expect(matchesRzlId('790', 79)).toBe(false);
  });
});
