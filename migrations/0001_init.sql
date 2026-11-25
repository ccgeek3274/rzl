-- RŽL evidence: seasons -> rounds (kola) -> tournaments (A/B/C on chess-results) -> entries (player results).
-- Raw chess-results HTML is kept so parsing can be improved without refetching.

CREATE TABLE seasons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                 -- "2025/26"
  start_year    INTEGER NOT NULL,              -- 2025 (category reference year)
  seed_tnr      INTEGER NOT NULL,              -- first A tournament; its details list all linked tournaments
  settings      TEXT NOT NULL DEFAULT '{}',    -- JSON SeasonSettings overrides (shared/rzl.ts)
  discovered_at INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id   INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  place       TEXT NOT NULL,                  -- with diacritics when known ("Týnec nad Sázavou")
  place_key   TEXT NOT NULL,                  -- chess-results link name ("Tynec")
  date        TEXT,                           -- YYYY-MM-DD
  UNIQUE (season_id, place_key)
);

CREATE TABLE tournaments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id      INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  round_id       INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tnr            INTEGER NOT NULL,
  grp            TEXT NOT NULL,               -- A | B | C
  link_name      TEXT NOT NULL,               -- "Pravonin B"
  title          TEXT,
  cr_last_update TEXT,                        -- "Poslední aktualizace" shown by chess-results
  rounds_count   INTEGER,
  player_count   INTEGER,
  status         TEXT NOT NULL DEFAULT 'new', -- new | fetched | error
  error          TEXT,
  fetched_at     INTEGER,
  raw_start      TEXT,
  raw_cross      TEXT,
  UNIQUE (season_id, tnr)
);

CREATE TABLE clubs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,                   -- short display name ("Říčany")
  full_name  TEXT NOT NULL,                   -- first raw spelling seen
  region     TEXT,                            -- 'in' | 'out' | NULL (undecided)
  note       TEXT
);

-- Raw chess-results club/place strings (folded) -> club. Different spellings merge into one club.
CREATE TABLE club_aliases (
  raw_key  TEXT PRIMARY KEY,
  raw      TEXT NOT NULL,
  club_id  INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE TABLE players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lok_id          INTEGER UNIQUE,             -- NULL = unregistered
  surname         TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  name_key        TEXT NOT NULL,              -- fold("surname first")
  gender          TEXT,                       -- M | F
  gender_source   TEXT,                       -- chesscz | guess | manual
  birth_year      INTEGER,
  birth_source    TEXT,                       -- chesscz | cr | manual
  club_id         INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  club_date       TEXT,                       -- date of the tournament the club was taken from
  club_locked     INTEGER NOT NULL DEFAULT 0, -- 1 = set manually, imports don't overwrite
  region_override TEXT,                       -- 'in' | 'out' | NULL (use club)
  chesscz         TEXT,                       -- JSON snapshot of /members/{lok}/cze
  chesscz_at      INTEGER,
  note            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX players_name_key ON players(name_key);

-- Extra identities resolving to a player (after merges / manual assignment): kind 'lok' or 'name'.
CREATE TABLE player_aliases (
  kind      TEXT NOT NULL,
  value     TEXT NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (kind, value)
);

CREATE TABLE entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  snr            INTEGER NOT NULL,
  cr_name        TEXT NOT NULL,
  cr_lok_id      INTEGER,
  rtg            INTEGER,
  club_raw       TEXT NOT NULL DEFAULT '',
  points         REAL NOT NULL,
  rank           INTEGER NOT NULL,
  games          TEXT NOT NULL DEFAULT '[]', -- JSON CrGame[]
  player_id      INTEGER REFERENCES players(id) ON DELETE SET NULL,
  match          TEXT,                       -- lok | alias | name | new | manual
  points_override REAL,
  rank_override  INTEGER,
  excluded       INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  updated_at     INTEGER,
  UNIQUE (tournament_id, snr)
);
CREATE INDEX entries_player ON entries(player_id);

-- Per-season player attributes.
CREATE TABLE season_players (
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  postup    TEXT,                            -- direct advancement marker: '1.10' | '1.2' | NULL
  note      TEXT,
  PRIMARY KEY (season_id, player_id)
);

-- Dismissed review warnings ("checked, it's fine").
CREATE TABLE issue_acks (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  issue_key  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, issue_key)
);

-- Outbound rate gates + chess.cz response cache.
CREATE TABLE rate_gate (
  id            TEXT PRIMARY KEY,            -- 'chesscz' | 'chessresults'
  last_fetch_at INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO rate_gate (id) VALUES ('chesscz'), ('chessresults');

CREATE TABLE chesscz_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
