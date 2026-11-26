-- Replay a season from zero: keeps seasons, rounds and the downloaded chess-results pages (tournaments.raw_*) and the
-- chess.cz cache, removes everything derived from them (results, players, instances, clubs, decisions).
-- Use: npm run db:fresh:local  (reset + 2025/26 seed + this script), then in the app "Načíst kolo" round by round.
DELETE FROM entries;
DELETE FROM player_instances;
DELETE FROM season_players;
DELETE FROM issue_acks;
DELETE FROM lok_verdicts;
DELETE FROM players;
DELETE FROM club_aliases;
DELETE FROM clubs;
UPDATE tournaments SET status = 'new', error = NULL, fetched_at = NULL, title = NULL, cr_last_update = NULL, rounds_count = NULL, player_count = NULL;
DELETE FROM sqlite_sequence WHERE name IN ('entries', 'player_instances', 'players', 'clubs');
