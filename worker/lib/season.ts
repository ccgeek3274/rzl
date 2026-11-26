// Loads a season from D1 and runs the shared rules engine (standings, Elo) + data-quality checks.
import type { CrGame } from '../../shared/chessresults';
import { categoryOf, computeElo, computeStandings, mergeSettings, roundPlacements, roundPoints, under8Marker, type EloStep, type SeasonSettings, type StPlayer } from '../../shared/rzl';
import { fold, rzlId, sameRegisteredName, similarNames, splitCrName } from '../../shared/text';
import type { Issue, ChessczInfo } from '../../shared/types';
import { fail } from './http';
import type { SeasonRow } from './importer';
import { backfillInstances, type InstanceRow } from './instances';

export type PlayerRow = {
  id: number;
  lok_id: number | null;
  surname: string;
  first_name: string;
  name_key: string;
  gender: string | null;
  gender_source: string | null;
  birth_year: number | null;
  birth_source: string | null;
  club_id: number | null;
  club_locked: number;
  region_override: string | null;
  chesscz: string | null;
  chesscz_at: number | null;
  note: string | null;
  club_name: string | null;
  club_region: string | null;
};

export type EntryRow = {
  id: number;
  tournament_id: number;
  snr: number;
  cr_name: string;
  cr_lok_id: number | null;
  rtg: number | null;
  club_raw: string;
  points: number;
  rank: number;
  games: string;
  player_id: number | null;
  match: string | null;
  instance_id: number | null;
  cr_mark: string | null;
  points_override: number | null;
  rank_override: number | null;
  excluded: number;
  note: string | null;
};

export type TournamentRow = {
  id: number;
  round_id: number;
  tnr: number;
  grp: string;
  link_name: string;
  title: string | null;
  cr_last_update: string | null;
  rounds_count: number | null;
  player_count: number | null;
  status: string;
  error: string | null;
  fetched_at: number | null;
  has_raw: number;
};

export type RoundRow = { id: number; ordinal: number; place: string; place_key: string; date: string | null };

export function eligibility(p: Pick<PlayerRow, 'region_override' | 'club_region'>): 'in' | 'out' | null {
  return (p.region_override as 'in' | 'out' | null) ?? (p.club_region as 'in' | 'out' | null) ?? null;
}

export async function getSeason(db: D1Database, id: number): Promise<SeasonRow> {
  const s = await db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id).first<SeasonRow>();
  if (!s) fail(404, 'Sezóna nenalezena');
  return s;
}

export async function loadSeason(db: D1Database, seasonId: number) {
  const season = await getSeason(db, seasonId);
  if (await db.prepare('SELECT 1 FROM entries WHERE instance_id IS NULL LIMIT 1').first()) await backfillInstances(db);
  const settings: SeasonSettings = mergeSettings(JSON.parse(season.settings || '{}'));
  const [rounds, tournaments, entries, players, sp, acks, allPlayers, instances, verdicts, instNames] = await Promise.all([
    db.prepare('SELECT id, ordinal, place, place_key, date FROM rounds WHERE season_id = ? ORDER BY ordinal').bind(seasonId).all<RoundRow>(),
    db
      .prepare(
        `SELECT t.id, t.round_id, t.tnr, t.grp, t.link_name, t.title, t.cr_last_update, t.rounds_count, t.player_count, t.status, t.error, t.fetched_at,
                (t.raw_start IS NOT NULL AND t.raw_cross IS NOT NULL) AS has_raw
         FROM tournaments t JOIN rounds r ON r.id = t.round_id WHERE t.season_id = ? ORDER BY r.ordinal, t.grp`
      )
      .bind(seasonId)
      .all<TournamentRow>(),
    db
      .prepare(
        `SELECT e.id, e.tournament_id, e.snr, e.cr_name, e.cr_lok_id, e.rtg, e.club_raw, e.points, e.rank, e.games, e.player_id, e.match, e.instance_id, e.cr_mark,
                e.points_override, e.rank_override, e.excluded, e.note
         FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?`
      )
      .bind(seasonId)
      .all<EntryRow>(),
    db
      .prepare(
        `SELECT p.*, c.name AS club_name, c.region AS club_region FROM players p LEFT JOIN clubs c ON c.id = p.club_id
         WHERE p.id IN (SELECT e.player_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?)`
      )
      .bind(seasonId)
      .all<PlayerRow>(),
    db.prepare('SELECT player_id, postup, note FROM season_players WHERE season_id = ?').bind(seasonId).all<{ player_id: number; postup: string | null; note: string | null }>(),
    db.prepare('SELECT issue_key FROM issue_acks WHERE season_id = ?').bind(seasonId).all<{ issue_key: string }>(),
    db.prepare('SELECT p.*, c.name AS club_name, c.region AS club_region FROM players p LEFT JOIN clubs c ON c.id = p.club_id').all<PlayerRow>(),
    db
      .prepare('SELECT * FROM player_instances WHERE id IN (SELECT e.instance_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE t.season_id = ?)')
      .bind(seasonId)
      .all<InstanceRow>(),
    db.prepare('SELECT lok_id, verdict, cz_name FROM lok_verdicts').all<{ lok_id: number; verdict: string; cz_name: string }>(),
    db.prepare('SELECT DISTINCT player_id, cr_name, name_key FROM player_instances WHERE player_id IS NOT NULL').all<{ player_id: number; cr_name: string; name_key: string }>(),
  ]);
  // Names a player appears under in tournaments other than the current one (name change, typos): searchable.
  const otherNames = new Map<number, string[]>();
  const nameKeyOf = new Map(allPlayers.results.map((p) => [p.id, p.name_key]));
  for (const r of instNames.results) {
    if (r.name_key === nameKeyOf.get(r.player_id)) continue;
    const { surname, firstName } = splitCrName(r.cr_name);
    const n = `${surname} ${firstName}`.trim();
    const list = otherNames.get(r.player_id) ?? otherNames.set(r.player_id, []).get(r.player_id)!;
    if (!list.includes(n)) list.push(n);
  }
  const playerMap = new Map(players.results.map((p) => [p.id, p]));
  const stPlayers = new Map<number, StPlayer>(
    players.results.map((p) => [p.id, { id: p.id, eligible: eligibility(p) === 'in', birthYear: p.birth_year }])
  );
  const roundById = new Map(rounds.results.map((r) => [r.id, r]));
  const stRounds = rounds.results.map((r) => ({ id: r.id, ordinal: r.ordinal, place: r.place, date: r.date }));
  const stTournaments = tournaments.results.map((t) => ({ id: t.id, roundId: t.round_id, group: t.grp }));
  const stEntries = entries.results.map((e) => ({
    id: e.id,
    tournamentId: e.tournament_id,
    playerId: e.player_id,
    rank: e.rank_override ?? e.rank,
    points: e.points_override ?? e.points,
    excluded: !!e.excluded,
  }));
  const standings = computeStandings(stRounds, stTournaments, stEntries, stPlayers, settings);
  const placements = roundPlacements(stRounds, stTournaments, stEntries, stPlayers);
  const elo = await playersElo(db, settings, [...playerMap.keys()]);
  const postup = new Map(sp.results.map((r) => [r.player_id, r]));
  return {
    otherNames,
    lokVerdicts: new Map(verdicts.results.map((v) => [v.lok_id, v])),
    season,
    settings,
    rounds: rounds.results,
    roundById,
    tournaments: tournaments.results,
    entries: entries.results,
    players: playerMap,
    allPlayers: allPlayers.results,
    instances: new Map(instances.results.map((i) => [i.id, i])),
    stPlayers,
    standings,
    placements,
    elo,
    postup,
    acks: new Set(acks.results.map((a) => a.issue_key)),
  };
}

export type LoadedSeason = Awaited<ReturnType<typeof loadSeason>>;

/** Elo history for the given players over ALL stored tournaments (the RŽL Elo carries across seasons). */
export async function playersElo(db: D1Database, settings: SeasonSettings, playerIds?: number[]): Promise<Map<number, EloStep[]>> {
  const rows = await db
    .prepare(
      `SELECT e.tournament_id, e.snr, e.player_id, e.rtg, e.games, e.excluded, r.date, r.ordinal, t.grp
       FROM entries e JOIN tournaments t ON t.id = e.tournament_id JOIN rounds r ON r.id = t.round_id`
    )
    .all<{ tournament_id: number; snr: number; player_id: number | null; rtg: number | null; games: string; excluded: number; date: string | null; ordinal: number; grp: string }>();
  const byT = new Map<number, Parameters<typeof computeElo>[0][0]>();
  for (const r of rows.results) {
    const t =
      byT.get(r.tournament_id) ??
      byT.set(r.tournament_id, { id: r.tournament_id, date: r.date, order: r.ordinal * 10 + r.grp.charCodeAt(0), players: [] }).get(r.tournament_id)!;
    t.players.push({ snr: r.snr, playerId: r.player_id, rtg: r.rtg, games: JSON.parse(r.games) as CrGame[] });
  }
  const hist = computeElo([...byT.values()], settings);
  if (!playerIds) return hist;
  const want = new Set(playerIds);
  return new Map([...hist].filter(([id]) => want.has(id)));
}

export function playerName(p: Pick<PlayerRow, 'surname' | 'first_name'>): string {
  return `${p.surname} ${p.first_name}`.trim();
}

export function chessczOf(p: PlayerRow): ChessczInfo | null {
  return p.chesscz ? JSON.parse(p.chesscz) : null;
}

/**
 * Rounds each player of the season has a row in (round id -> "3B"). One person plays one tournament per round, so two
 * records in the same round are two different people.
 */
export function roundsByPlayer(L: LoadedSeason, by: 'player' | 'instance' = 'player'): Map<number, Map<number, string>> {
  const tById = new Map(L.tournaments.map((t) => [t.id, t]));
  const out = new Map<number, Map<number, string>>();
  for (const e of L.entries) {
    const k = by === 'player' ? e.player_id : e.instance_id;
    if (k == null) continue;
    const t = tById.get(e.tournament_id)!;
    const m = out.get(k) ?? out.set(k, new Map()).get(k)!;
    m.set(t.round_id, `${L.roundById.get(t.round_id)?.ordinal ?? '?'}${t.grp}`);
  }
  return out;
}

/** Label of a round both have a row in ("3B"), or null. */
export function sharedRound(a: Map<number, string> | undefined, b: Map<number, string> | undefined): string | null {
  if (!a || !b) return null;
  for (const [rid, label] of b) if (a.has(rid)) return label;
  return null;
}

/** Standings rows enriched with player data for the UI / exports. */
export function standingsView(L: LoadedSeason) {
  const y = L.season.start_year;
  return L.standings.map((r) => {
    const p = L.players.get(r.playerId)!;
    const cz = chessczOf(p);
    const steps = L.elo.get(r.playerId);
    return {
      ...r,
      name: playerName(p),
      otherNames: L.otherNames.get(p.id) ?? [],
      lokId: p.lok_id,
      gender: p.gender,
      genderSource: p.gender_source,
      birthYear: p.birth_year,
      category: categoryOf(p.birth_year, y, L.settings.hd8),
      // With a separate HD8 category the H8/D8 marker says nothing more.
      marker: L.settings.hd8 ? '' : under8Marker(p.birth_year, p.gender, y),
      club: p.club_name,
      rzlElo: steps?.length ? steps[steps.length - 1].after : null,
      lokElo: cz?.czeStdElo || null,
      lokRapidElo: cz?.czeRapidElo || null,
      postup: L.postup.get(r.playerId)?.postup ?? null,
    };
  });
}

/** Only warnings / infos that can be fine as they are can be marked "V pořádku"; errors and guessed genders must be resolved. */
export function isAckable(i: Pick<Issue, 'key' | 'severity'>): boolean {
  return i.severity !== 'error' && !i.key.startsWith('gender-') && i.key !== 'inst-open';
}

/** Data-quality checks shown on the "Kontrola" tab. Keys are stable so a warning can be dismissed. */
export function seasonIssues(L: LoadedSeason): Issue[] {
  const out: Issue[] = [];
  const tById = new Map(L.tournaments.map((t) => [t.id, t]));
  // Tournaments
  for (const r of L.rounds) {
    const ts = L.tournaments.filter((t) => t.round_id === r.id);
    const groups = ts.map((t) => t.grp).sort().join('');
    if (groups !== 'ABC') out.push({ key: `round-groups:${r.id}`, type: 'round', severity: 'warning', title: `Kolo ${r.ordinal} (${r.place}) má turnaje „${groups || '—'}“ místo A, B, C`, refs: {} });
    for (const t of ts) {
      if (t.status === 'error') out.push({ key: `t-error:${t.id}`, type: 'tournament', severity: 'error', title: `${t.link_name}: chyba načtení`, detail: t.error ?? '', refs: { tournamentId: t.id } });
    }
  }
  // Clubs without region decision
  const undecidedClubs = new Map<number, { name: string; players: string[] }>();
  for (const p of L.players.values()) {
    if (eligibility(p) !== null) continue;
    const k = p.club_id ?? 0;
    const c = undecidedClubs.get(k) ?? undecidedClubs.set(k, { name: p.club_name ?? '(bez oddílu)', players: [] }).get(k)!;
    c.players.push(playerName(p));
  }
  for (const [clubId, c] of undecidedClubs) {
    out.push({
      key: `club-region:${clubId}`,
      type: 'club',
      severity: 'error',
      title: `Oddíl/místo „${c.name}“: nerozhodnuto, zda patří do regionu`,
      detail: `${c.players.length} hráč(ů): ${c.players.slice(0, 8).join(', ')}${c.players.length > 8 ? '…' : ''}. Dokud není rozhodnuto, hráči se nezapočítávají.`,
      refs: { clubId: clubId || undefined },
    });
  }
  // Players
  const roundsOfPlayer = new Map<number, Map<number, number[]>>();
  const openSeen = new Set<number>();
  for (const e of L.entries) {
    const t0 = tById.get(e.tournament_id)!;
    if (e.player_id == null) {
      const inst = e.instance_id != null ? L.instances.get(e.instance_id) : undefined;
      if (inst && inst.player_id == null) {
        openSeen.add(inst.id);
      } else out.push({ key: `unmatched:${e.id}`, type: 'entry', severity: 'error', title: `${e.cr_name}: řádek není přiřazen hráči`, refs: { entryId: e.id, tournamentId: e.tournament_id } });
      continue;
    }
    if (e.excluded) continue;
    const t = tById.get(e.tournament_id)!;
    const m = roundsOfPlayer.get(e.player_id) ?? roundsOfPlayer.set(e.player_id, new Map()).get(e.player_id)!;
    (m.get(t.round_id) ?? m.set(t.round_id, []).get(t.round_id)!).push(e.id);
    // Did not play at all (only forfeit losses / byes): the official sheet leaves such rows out.
    const games = JSON.parse(e.games) as CrGame[];
    if (games.length && !games.some((g) => g.kind === 'game' || (g.kind === 'forfeit' && g.score > 0)))
      out.push({
        key: `no-show:${e.id}`,
        type: 'entry',
        severity: 'warning',
        title: `${e.cr_name} (${t.link_name}) nenastoupil(a) – neodehrál(a) žádnou partii`,
        detail: `Zatím se počítá (${e.points_override ?? e.points} b., umístění v kole) a hráči za ním mají o místo horší umístění. Oficiální tabulka takové řádky vynechává → „Nezapočítávat“.`,
        refs: { entryId: e.id, playerId: e.player_id, tournamentId: e.tournament_id },
      });
    if (e.points_override != null || e.rank_override != null)
      out.push({ key: `override:${e.id}`, type: 'override', severity: 'info', title: `${e.cr_name} (${t.link_name}): ruční oprava výsledku`, detail: e.note ?? '', refs: { entryId: e.id, tournamentId: e.tournament_id } });
  }
  for (const [pid, m] of roundsOfPlayer) {
    for (const [rid, ids] of m) {
      if (ids.length > 1) {
        const p = L.players.get(pid)!;
        out.push({ key: `two-in-round:${pid}:${rid}`, type: 'player', severity: 'error', title: `${playerName(p)} má v kole ${L.roundById.get(rid)?.ordinal} více výsledků`, detail: 'Započítá se lepší z nich. Zkontrolujte přiřazení (nejde o dva různé hráče?).', refs: { playerId: pid } });
      }
    }
  }
  // Instances: assigned automatically and not yet checked (one summary line, the list is on the "Párování" tab);
  // birth year on the tournament's player card differs from the player's.
  if (openSeen.size)
    out.push({
      key: 'inst-open',
      type: 'match',
      severity: 'error',
      title: `${openSeen.size} hráčů z turnajů čeká na rozhodnutí, komu patří`,
      detail: 'Rozhodněte na záložce Párování. Dokud není přiřazeno, jejich výsledky se nezapočítávají.',
      refs: {},
    });
  for (const i of L.instances.values()) {
    const p = i.player_id != null ? L.players.get(i.player_id) : undefined;
    if (p && i.birth_year && p.birth_year && i.birth_year !== p.birth_year)
      out.push({
        key: `inst-birth:${i.id}:${i.birth_year}`,
        type: 'match',
        severity: 'warning',
        title: `${playerName(p)}: v turnaji jako „${i.cr_name}“ s rokem narození ${i.birth_year}, v evidenci aplikace ${p.birth_year}`,
        detail: 'Nejde o jiného hráče se stejným jménem? Pak instanci přiřaďte jinak.',
        refs: { playerId: p.id, instanceId: i.id },
      });
  }
  for (const p of L.players.values()) {
    const elig = eligibility(p);
    const cz = chessczOf(p);
    if (p.lok_id && !p.chesscz_at) out.push({ key: `no-chesscz:${p.id}`, type: 'player', severity: 'info', title: `${playerName(p)}: nenačteno z chess.cz`, refs: { playerId: p.id } });
    const verdict = p.lok_id ? L.lokVerdicts.get(p.lok_id) : undefined;
    if (verdict?.verdict === 'cz-error' && cz && !sameRegisteredName(cz.fullName, playerName(p)))
      out.push({
        key: `cz-error:${p.lok_id}`,
        type: 'player',
        severity: 'info',
        title: `${playerName(p)}: na chess.cz je u LOK ${p.lok_id} chybně „${cz.fullName}“`,
        detail: 'LOK patří tomuto hráči, jméno na chess.cz je chybné – nahlaste oddílu / ŠSČR k opravě. Jméno a pohlaví z chess.cz se nepoužívají.',
        refs: { playerId: p.id },
      });
    else if (!verdict && cz && fold(cz.fullName) !== p.name_key && !sameNameLoose(cz.fullName, p))
      out.push({
        key: `lok-name:${p.id}:${p.lok_id}`,
        type: 'player',
        severity: 'warning',
        title: `${playerName(p)}: LOK ${p.lok_id} patří na chess.cz hráči „${cz.fullName}“`,
        detail: 'Buď změna jména (pak je vše v pořádku), nebo chybné ID v turnaji.',
        refs: { playerId: p.id },
      });
    if (p.lok_id && p.chesscz_at && !cz) out.push({ key: `lok-missing:${p.id}`, type: 'player', severity: 'warning', title: `${playerName(p)}: LOK ${p.lok_id} na chess.cz neexistuje`, refs: { playerId: p.id } });
    if (elig === 'in') {
      if (!p.birth_year) out.push({ key: `no-birth:${p.id}`, type: 'player', severity: 'warning', title: `${playerName(p)}: chybí rok narození (kategorie)`, refs: { playerId: p.id } });
    }
    if (elig !== 'out') {
      if (p.gender !== 'M' && p.gender !== 'F')
        out.push({ key: `gender-none:${p.id}`, type: 'gender', severity: 'error', title: `${playerName(p)}: neznámé pohlaví`, detail: 'Nastavte H / D (pořadí dívek).', refs: { playerId: p.id } });
      else if (p.gender_source === 'guess')
        out.push({
          key: `gender-guess:${p.id}`,
          type: 'gender',
          severity: 'warning',
          title: `${playerName(p)}: pohlaví jen odhadnuto podle jména (${p.gender === 'F' ? 'D' : 'H'})`,
          detail: p.lok_id ? 'Načtěte z chess.cz, nebo potvrďte.' : 'Hráč bez registrace – potvrďte.',
          refs: { playerId: p.id, gender: p.gender },
        });
    }
  }
  // Possible duplicates: same / similar names, at least one side unregistered (two LOK IDs = two people).
  // Compared against ALL players (earlier seasons too); a known differing birth year rules the pair out.
  const seasonIds = new Set(L.players.keys());
  const seen = new Set<string>();
  const rounds = roundsByPlayer(L);
  for (const a of L.players.values()) {
    for (const b of L.allPlayers) {
      if (a.id === b.id || (seasonIds.has(b.id) && b.id < a.id)) continue;
      if (a.lok_id && b.lok_id) continue;
      const how = similarNames(a.name_key, b.name_key);
      if (!how) continue;
      // Both played in the same round: two people.
      if (sharedRound(rounds.get(a.id), rounds.get(b.id))) continue;
      const by = a.birth_year && b.birth_year ? (a.birth_year === b.birth_year ? 'same' : 'diff') : 'unknown';
      if (by === 'diff' && how !== 'same') continue;
      const ids = [a.id, b.id].sort((x, y) => x - y);
      const key = `${how === 'same' ? 'dup-name' : 'similar'}:${ids.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [p1, p2] = ids.map((id) => (id === a.id ? a : b));
      const lokNote = p1.lok_id || p2.lok_id ? ' Jeden z nich má LOK – mohl se zaregistrovat v průběhu sezóny.' : '';
      out.push({
        key,
        type: 'duplicate',
        severity: by === 'diff' ? 'info' : 'warning',
        title:
          how === 'same'
            ? `Více hráčů se jménem ${playerName(p1)}`
            : `Podobná jména: ${playerName(p1)} × ${playerName(p2)}${how === 'swap' ? ' (prohozené jméno/příjmení)' : ''}`,
        detail:
          [p1, p2].map((p) => `${rzlId(p.id)} ${p.lok_id ? `LOK ${p.lok_id}` : 'bez LOK'}, nar. ${p.birth_year ?? '?'} (${p.club_name ?? '?'})`).join(' · ') +
          (by === 'same' ? ' – stejný rok narození.' : by === 'diff' ? ' – jiný rok narození, nejspíš dva hráči.' : '.') +
          lokNote +
          ' Jde o téhož hráče? Pak je slučte.',
        refs: { playerIds: ids },
      });
    }
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  return out.map((i) => ({ ...i, acked: isAckable(i) && L.acks.has(i.key) })).sort((a, b) => Number(a.acked) - Number(b.acked) || order[a.severity] - order[b.severity]);
}

/** chess.cz "Nguyen Van An - Minh" vs CR "Nguyen, Van An-Minh": compare without spaces/dashes. */
function sameNameLoose(full: string, p: PlayerRow): boolean {
  const a = fold(full).replace(/[\s-]/g, '');
  const b = fold(p.surname + p.first_name).replace(/[\s-]/g, '');
  const swapped = fold(p.first_name + p.surname).replace(/[\s-]/g, '');
  return a === b || a === swapped;
}

/** Per-entry view for the tournament page. */
export function tournamentView(L: LoadedSeason, tournamentId: number) {
  const t = L.tournaments.find((x) => x.id === tournamentId);
  if (!t) fail(404, 'Turnaj nenalezen');
  const round = L.roundById.get(t.round_id)!;
  const entries = L.entries
    .filter((e) => e.tournament_id === tournamentId)
    .sort((a, b) => (a.rank_override ?? a.rank) - (b.rank_override ?? b.rank));
  return {
    tournament: t,
    round,
    entries: entries.map((e) => {
      const p = e.player_id != null ? L.players.get(e.player_id) : undefined;
      const pts = e.points_override ?? e.points;
      const step = e.player_id != null ? L.elo.get(e.player_id)?.find((s) => s.tournamentId === tournamentId) : undefined;
      return {
        id: e.id,
        snr: e.snr,
        crName: e.cr_name,
        crLokId: e.cr_lok_id,
        rtg: e.rtg,
        clubRaw: e.club_raw,
        points: e.points,
        rank: e.rank,
        pointsOverride: e.points_override,
        rankOverride: e.rank_override,
        excluded: !!e.excluded,
        note: e.note,
        match: e.match,
        mark: e.cr_mark,
        instance: (() => {
          const i = e.instance_id != null ? L.instances.get(e.instance_id) : undefined;
          return i ? { id: i.id, status: i.status, reason: i.reason } : null;
        })(),
        games: JSON.parse(e.games) as CrGame[],
        rzlPoints: roundPoints(t.grp, pts, L.settings),
        placement: L.placements.get(e.id) ?? null,
        eloDelta: step ? step.delta : null,
        eloAfter: step ? step.after : null,
        player: p
          ? { id: p.id, name: playerName(p), lokId: p.lok_id, club: p.club_name, eligibility: eligibility(p), birthYear: p.birth_year, gender: p.gender, genderSource: p.gender_source }
          : null,
      };
    }),
  };
}
