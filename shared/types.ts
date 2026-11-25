// API shapes shared by worker and web.
import type { CrGame } from './chessresults';
import type { InstanceHow, InstanceStatus } from './identity';
import type { Category, RoundResult, SeasonSettings } from './rzl';

export type Severity = 'error' | 'warning' | 'info';

export type Issue = {
  key: string;
  type: 'round' | 'tournament' | 'club' | 'entry' | 'match' | 'override' | 'player' | 'duplicate' | 'gender';
  severity: Severity;
  title: string;
  detail?: string;
  acked?: boolean;
  refs: { tournamentId?: number; entryId?: number; playerId?: number; playerIds?: number[]; clubId?: number; instanceId?: number; gender?: string | null };
};

export type SeasonSummary = {
  id: number;
  name: string;
  startYear: number;
  seedTnr: number;
  discoveredAt: number | null;
  tournaments: number;
  fetched: number;
};

export type TournamentDto = {
  id: number;
  roundId: number;
  tnr: number;
  grp: string;
  linkName: string;
  title: string | null;
  crLastUpdate: string | null;
  roundsCount: number | null;
  playerCount: number | null;
  status: 'new' | 'fetched' | 'error';
  error: string | null;
  fetchedAt: number | null;
  /** A downloaded copy of the chess-results pages is stored (can be imported again without network). */
  hasRaw: boolean;
};

export type RoundDto = { id: number; ordinal: number; place: string; date: string | null };

export type SeasonDto = {
  id: number;
  name: string;
  startYear: number;
  seedTnr: number;
  settings: SeasonSettings;
  discoveredAt: number | null;
  rounds: RoundDto[];
  tournaments: TournamentDto[];
  issueCounts: Record<Severity, number>;
  /** Instances of the season waiting for a decision / for a check. */
  instanceCounts: { open: number; auto: number };
};

export type StandingDto = {
  playerId: number;
  rank: number;
  tied: boolean;
  total: number;
  placementSum: number;
  nTournaments: number;
  results: Record<number, RoundResult>;
  name: string;
  lokId: number | null;
  gender: string | null;
  genderSource: string | null;
  birthYear: number | null;
  category: Category | null;
  marker: string;
  club: string | null;
  rzlElo: number | null;
  lokElo: number | null;
  lokRapidElo: number | null;
  postup: string | null;
};

export type EntryDto = {
  id: number;
  snr: number;
  crName: string;
  crLokId: number | null;
  rtg: number | null;
  clubRaw: string;
  points: number;
  rank: number;
  pointsOverride: number | null;
  rankOverride: number | null;
  excluded: boolean;
  note: string | null;
  /** 'manual' = this row is assigned by hand, regardless of its instance. */
  match: string | null;
  /** Organizer's "do A" note removed from the name. */
  mark: string | null;
  instance: { id: number; status: InstanceStatus; reason: string | null } | null;
  games: CrGame[];
  rzlPoints: number;
  placement: number | null;
  eloDelta: number | null;
  eloAfter: number | null;
  player: { id: number; name: string; lokId: number | null; club: string | null; eligibility: 'in' | 'out' | null; birthYear: number | null; gender: string | null; genderSource: string | null } | null;
};

export type TournamentDetailDto = { tournament: TournamentDto; round: RoundDto; entries: EntryDto[] };

export type SeasonPlayerDto = {
  id: number;
  lokId: number | null;
  surname: string;
  firstName: string;
  name: string;
  gender: string | null;
  genderSource: string | null;
  birthYear: number | null;
  birthSource: string | null;
  category: Category | null;
  clubId: number | null;
  club: string | null;
  clubLocked: boolean;
  regionOverride: 'in' | 'out' | null;
  eligibility: 'in' | 'out' | null;
  tournaments: number;
  rzlElo: number | null;
  chesscz: ChessczInfo | null;
  chessczAt: number | null;
  postup: string | null;
  note: string | null;
  issues: number;
};

export type PlayerDetailDto = {
  player: SeasonPlayerDto;
  instances: PlayerInstanceDto[];
  results: {
    entryId: number;
    seasonId: number;
    seasonName: string;
    tournamentId: number;
    linkName: string;
    date: string | null;
    group: string;
    crName: string;
    crLokId: number | null;
    clubRaw: string;
    rtg: number | null;
    points: number;
    rank: number;
    match: string | null;
    instanceId: number | null;
    excluded: boolean;
    eloBefore: number | null;
    eloDelta: number | null;
    eloAfter: number | null;
  }[];
};

export type ClubDto = { id: number; name: string; fullName: string; region: 'in' | 'out' | null; note: string | null; aliases: string[]; players: number };

/** Short player info shown next to an instance. */
export type PlayerBriefDto = {
  id: number;
  name: string;
  lokId: number | null;
  birthYear: number | null;
  club: string | null;
  clubId: number | null;
  /** Name on chess.cz for the player's LOK. */
  czName: string | null;
  gender: string | null;
  genderSource: string | null;
  eligibility: 'in' | 'out' | null;
  instances: number;
};

/** An instance on the player card (all seasons). */
export type PlayerInstanceDto = {
  id: number;
  status: InstanceStatus;
  how: InstanceHow | null;
  reason: string | null;
  crName: string;
  lokId: number | null;
  club: string;
  birthYear: number | null;
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
};

/** An instance on the "Párování" tab (season scope). */
export type InstanceDto = {
  id: number;
  status: InstanceStatus;
  how: InstanceHow | null;
  reason: string | null;
  crName: string;
  lokId: number | null;
  club: string;
  /** Club of the app the tournament's club spelling belongs to (to compare with the player's club). */
  clubId: number | null;
  birthYear: number | null;
  birthChecked: boolean;
  /** Round ordinal where the instance first appears in this season. */
  firstRound: number;
  /** Instance existed before this season (recycled). */
  recycled: boolean;
  rows: { entryId: number; tournamentId: number; linkName: string; round: number; grp: string; snr: number; rank: number; points: number; mark: string | null; manual: boolean }[];
  player: PlayerBriefDto | null;
  /** What differs from the player's other instances / record ("oddíl: Vlašim → Benešov"). */
  changes: string[];
  candidates: { player: PlayerBriefDto; why: string }[];
};

/** What is kept from chess.cz for a registered player (players.chesscz JSON). Elo 0 / missing = none. */
export type ChessczInfo = {
  fullName: string;
  birthYear: number | null;
  gender: string;
  clubName: string | null;
  clubId?: string | null; // chess.cz club code (for the Elo refresh by clubs)
  registration?: string;
  czeStdElo: number;
  czeRapidElo: number;
  fideId?: number;
  fideStdElo?: number;
  fideRapidElo?: number;
  fideBlitzElo?: number;
};
