// RŽL (Regionální žákovská liga) rules engine — pure functions shared by worker + web.
//
// Verified against the official 2026/27 standings PDF (rounds 1–3) and the 2024/25 final PDF:
//  * One round (kolo) = three Swiss tournaments A, B, C. A player plays exactly one of them.
//  * Round points: A = 2×points + 5, B = points + 2, C = points.
//  * Round placement: regional players only, A ranks first, then B (continuing), then C.
//  * Season total = best N (5) round results; tiebreak = lower sum of placements of the counted results.
//  * Categories by birth year relative to the season start year Y: J ≤ Y-15, HD16 Y-14..Y-13,
//    HD14 Y-12..Y-11, HD12 Y-10..Y-9, HD10 ≥ Y-8; marker H8/D8 for ≥ Y-6.
//    Some seasons (2025/26) rank H8/D8 as a separate category HD8 (setting `hd8`).
//  * Rows where the player did not play at all (only forfeits/byes) are left out of the official sheet → Kontrola flags them.
//  * RŽL Elo = Swiss-Manager national rating calc: new = Rtg + K·Σ(score − expected) per tournament,
//    using the Rtg values printed in that tournament; K = 25, new player 1000, floor 900 (2024/25: 800).
//    Byes and forfeits do not count.

import type { CrGame } from './chessresults';

export type Group = 'A' | 'B' | 'C';

export type ScoringRule = { mult: number; add: number };

export type SeasonSettings = {
  bestN: number;
  scoring: Record<Group, ScoringRule>;
  elo: { k: number; start: number; floor: number };
  hd8: boolean; // separate category HD8 (born ≥ Y-6) instead of ranking them within HD10
};

export const DEFAULT_SETTINGS: SeasonSettings = {
  bestN: 5,
  scoring: { A: { mult: 2, add: 5 }, B: { mult: 1, add: 2 }, C: { mult: 1, add: 0 } },
  elo: { k: 25, start: 1000, floor: 900 },
  hd8: false,
};

export function mergeSettings(raw: unknown): SeasonSettings {
  const r = (raw ?? {}) as Partial<SeasonSettings>;
  return {
    bestN: r.bestN ?? DEFAULT_SETTINGS.bestN,
    scoring: { ...DEFAULT_SETTINGS.scoring, ...(r.scoring ?? {}) },
    elo: { ...DEFAULT_SETTINGS.elo, ...(r.elo ?? {}) },
    hd8: r.hd8 ?? DEFAULT_SETTINGS.hd8,
  };
}

export function roundPoints(group: string, points: number, s: SeasonSettings): number {
  const rule = s.scoring[group as Group] ?? { mult: 1, add: 0 };
  return rule.mult * points + rule.add;
}

// ───────────────────────────── categories ─────────────────────────────

export type Category = 'J' | '16' | '14' | '12' | '10' | '8';
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'J', label: 'Junioři' },
  { id: '16', label: 'HD 16' },
  { id: '14', label: 'HD 14' },
  { id: '12', label: 'HD 12' },
  { id: '10', label: 'HD 10' },
  { id: '8', label: 'HD 8' },
];

export const seasonCategories = (hd8: boolean) => CATEGORIES.filter((c) => hd8 || c.id !== '8');

export function categoryOf(birthYear: number | null | undefined, startYear: number, hd8 = false): Category | null {
  if (!birthYear) return null;
  const d = startYear - birthYear;
  if (hd8 && d <= 6) return '8';
  if (d >= 15) return 'J';
  if (d >= 13) return '16';
  if (d >= 11) return '14';
  if (d >= 9) return '12';
  return '10';
}

/** "H8" / "D8" marker for the youngest players (printed in the VT column of the official sheet). */
export function under8Marker(birthYear: number | null | undefined, gender: string | null | undefined, startYear: number): string {
  if (!birthYear || startYear - birthYear > 6) return '';
  return gender === 'F' ? 'D8' : 'H8';
}

// ───────────────────────────── standings ─────────────────────────────

export type StRound = { id: number; ordinal: number; place: string; date: string | null };
export type StTournament = { id: number; roundId: number; group: string };
export type StEntry = {
  id: number;
  tournamentId: number;
  playerId: number | null;
  rank: number; // effective (override applied)
  points: number; // effective tournament points (override applied)
  excluded: boolean;
};
export type StPlayer = { id: number; eligible: boolean; birthYear: number | null };

export type RoundResult = {
  roundId: number;
  entryId: number;
  group: string;
  tourPoints: number;
  rank: number;
  points: number; // RŽL points
  placement: number;
  counted: boolean;
};

export type StandingRow = {
  playerId: number;
  rank: number;
  tied: boolean;
  total: number;
  placementSum: number;
  nTournaments: number;
  results: Record<number, RoundResult>; // by roundId
};

/** Round placements for all counted entries: entryId -> placement. */
export function roundPlacements(
  rounds: StRound[],
  tournaments: StTournament[],
  entries: StEntry[],
  players: Map<number, StPlayer>
): Map<number, number> {
  const out = new Map<number, number>();
  const byT = new Map<number, StEntry[]>();
  for (const e of entries) {
    if (e.excluded || e.playerId == null || !players.get(e.playerId)?.eligible) continue;
    (byT.get(e.tournamentId) ?? byT.set(e.tournamentId, []).get(e.tournamentId)!).push(e);
  }
  for (const r of rounds) {
    const ts = tournaments.filter((t) => t.roundId === r.id).sort((a, b) => a.group.localeCompare(b.group));
    let place = 0;
    for (const t of ts) {
      const es = (byT.get(t.id) ?? []).slice().sort((a, b) => a.rank - b.rank);
      for (const e of es) out.set(e.id, ++place);
    }
  }
  return out;
}

export function computeStandings(
  rounds: StRound[],
  tournaments: StTournament[],
  entries: StEntry[],
  players: Map<number, StPlayer>,
  s: SeasonSettings
): StandingRow[] {
  const placements = roundPlacements(rounds, tournaments, entries, players);
  const tById = new Map(tournaments.map((t) => [t.id, t]));
  const rows = new Map<number, StandingRow>();
  for (const e of entries) {
    const placement = placements.get(e.id);
    if (placement == null || e.playerId == null) continue;
    const t = tById.get(e.tournamentId)!;
    const row =
      rows.get(e.playerId) ??
      rows.set(e.playerId, { playerId: e.playerId, rank: 0, tied: false, total: 0, placementSum: 0, nTournaments: 0, results: {} }).get(e.playerId)!;
    const res: RoundResult = {
      roundId: t.roundId,
      entryId: e.id,
      group: t.group,
      tourPoints: e.points,
      rank: e.rank,
      points: roundPoints(t.group, e.points, s),
      placement,
      counted: false,
    };
    // Data error guard: two results in one round -> keep the better one (an issue is reported elsewhere).
    const prev = row.results[t.roundId];
    if (!prev || betterResult(res, prev) < 0) row.results[t.roundId] = res;
  }
  for (const row of rows.values()) {
    const list = Object.values(row.results).sort(betterResult);
    row.nTournaments = list.length;
    for (const r of list.slice(0, s.bestN)) {
      r.counted = true;
      row.total += r.points;
      row.placementSum += r.placement;
    }
  }
  const sorted = [...rows.values()].sort(compareRows);
  rankRows(sorted);
  return sorted;
}

function betterResult(a: RoundResult, b: RoundResult): number {
  return b.points - a.points || a.placement - b.placement;
}

function compareRows(a: StandingRow, b: StandingRow): number {
  return b.total - a.total || a.placementSum - b.placementSum;
}

/** Assign ranks in place; equal total + placement sum share the rank. */
export function rankRows(sorted: StandingRow[]): void {
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    if (prev && compareRows(prev, r) === 0) {
      r.rank = prev.rank;
      r.tied = prev.tied = true;
    } else r.rank = i + 1;
  });
}

/** Category table = overall rows filtered and re-ranked. */
export function categoryStandings(rows: StandingRow[], players: Map<number, StPlayer>, cat: Category, startYear: number): StandingRow[] {
  const out = rows.filter((r) => categoryOf(players.get(r.playerId)?.birthYear, startYear) === cat).map((r) => ({ ...r }));
  rankRows(out);
  return out;
}

// ───────────────────────────── Elo ─────────────────────────────

export type EloTournament = {
  id: number;
  date: string | null;
  order: number; // tie-breaker for equal dates (round ordinal * 10 + group index)
  players: { snr: number; playerId: number | null; rtg: number | null; games: CrGame[] }[];
};

export type EloStep = {
  tournamentId: number;
  before: number; // rating used in the tournament (its Rtg, or start rating when missing)
  delta: number;
  after: number; // floored
  games: number;
  score: number;
  expected: number;
};

/**
 * Swiss-Manager style rating calc per tournament (ratings frozen during the tournament):
 * delta = K · Σ (score − 1/(1+10^((Ropp−R)/400))) over played games (no byes/forfeits).
 */
export function computeElo(tournaments: EloTournament[], s: SeasonSettings): Map<number, EloStep[]> {
  const { k, start, floor } = s.elo;
  const hist = new Map<number, EloStep[]>();
  const sorted = tournaments.slice().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.order - b.order);
  for (const t of sorted) {
    const bySnr = new Map(t.players.map((p) => [p.snr, p]));
    for (const p of t.players) {
      if (p.playerId == null) continue;
      const before = p.rtg ?? start;
      let score = 0;
      let expected = 0;
      let games = 0;
      for (const g of p.games) {
        if (g.kind !== 'game') continue;
        const o = bySnr.get(g.opp);
        if (!o) continue;
        const ro = o.rtg ?? start;
        score += g.score;
        expected += 1 / (1 + Math.pow(10, (ro - before) / 400));
        games++;
      }
      const delta = k * (score - expected);
      const after = Math.max(floor, Math.round(before + delta));
      const list = hist.get(p.playerId) ?? hist.set(p.playerId, []).get(p.playerId)!;
      list.push({ tournamentId: t.id, before, delta, after, games, score, expected });
    }
  }
  return hist;
}
