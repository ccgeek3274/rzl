-- Instance-based player identification (shared/identity.ts).
-- An instance = unique (normalized name, LOK from the tournament, normalized club) under which a player appears in
-- tournaments. Rows (entries) point to their instance; the instance points to the player (root, RŽL ID).
-- Replaces player_aliases: what used to be a hidden alias is now a visible instance of the player.

CREATE TABLE player_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     INTEGER REFERENCES players(id) ON DELETE SET NULL, -- NULL = waiting for a decision
  cr_name       TEXT NOT NULL,              -- as written in the tournament (first occurrence)
  name_key      TEXT NOT NULL,
  lok_id        INTEGER,                    -- ID column of the tournament (may be wrong / someone else's)
  lok_key       INTEGER NOT NULL DEFAULT 0, -- lok_id or 0 (UNIQUE treats NULLs as distinct)
  club_raw      TEXT NOT NULL DEFAULT '',
  club_key      TEXT NOT NULL DEFAULT '',
  birth_year    INTEGER,                    -- from the chess-results player card
  birth_checked INTEGER NOT NULL DEFAULT 0, -- player card already read
  status        TEXT NOT NULL,              -- open (to decide) | auto (assigned, to check) | ok (confirmed)
  how           TEXT,                       -- new | lok | lok-instance | manual | legacy
  reason        TEXT,                       -- why it was assigned / left open (shown to the operator)
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  UNIQUE (name_key, lok_key, club_key)
);
CREATE INDEX player_instances_player ON player_instances(player_id);

ALTER TABLE entries ADD COLUMN instance_id INTEGER REFERENCES player_instances(id) ON DELETE SET NULL;
ALTER TABLE entries ADD COLUMN cr_mark TEXT; -- "A" / "B": organizer's "do A" note removed from the name
CREATE INDEX entries_instance ON entries(instance_id);

DROP TABLE player_aliases;
-- entries.match now only marks a row-level exception: 'manual' = this row is assigned by hand, regardless of its instance.
-- Old values (lok / alias / name / new) are rewritten when existing data is converted to instances (worker/lib/instances.ts).
