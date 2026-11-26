-- History of the operator's decisions and corrections (Kontrola → Historie). Written by the API on each decision;
-- season_id NULL = not tied to one season (e.g. a club's region), shown in every season.
CREATE TABLE decision_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id     INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL,   -- pairing | lok | gender | entry | ack | club | player | merge
  title         TEXT NOT NULL,
  detail        TEXT,
  player_id     INTEGER,
  tournament_id INTEGER,
  instance_id   INTEGER
);
CREATE INDEX decision_log_season ON decision_log(season_id, at);

-- Decisions made before the log existed, as far as the data tell (pairings decided by the operator, LOK verdicts).
INSERT INTO decision_log (season_id, at, kind, title, player_id, instance_id)
SELECT (SELECT t.season_id FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.instance_id = i.id LIMIT 1),
       i.decided_at, 'pairing',
       CASE WHEN i.how = 'manual' THEN 'Párování: ' ELSE 'Potvrzeno: ' END || replace(i.cr_name, ',', '') || ' → ' || p.surname || ' ' || p.first_name || ' (R' || substr('0000' || p.id, -4) || ')',
       p.id, i.id
FROM player_instances i JOIN players p ON p.id = i.player_id
WHERE i.status = 'ok' AND i.decided_at IS NOT NULL AND i.how IS NOT 'legacy';
INSERT INTO decision_log (season_id, at, kind, title, detail)
SELECT NULL, v.created_at, 'lok',
       'LOK ' || v.lok_id || ': ' || CASE v.verdict WHEN 'cz' THEN 'Platí chess.cz' WHEN 'cz-error' THEN 'Chyba na chess.cz' ELSE 'Chybné LOK v turnaji' END,
       replace(v.cr_name, ',', '') || ' v turnaji, na chess.cz „' || v.cz_name || '“'
FROM lok_verdicts v;
INSERT INTO decision_log (season_id, at, kind, title, player_id, tournament_id)
SELECT t.season_id, COALESCE(e.updated_at, 0), 'entry',
       replace(e.cr_name, ',', '') || ' (' || t.link_name || '): nezapočítává se' || CASE WHEN e.note IS NOT NULL THEN ', poznámka: ' || e.note ELSE '' END,
       e.player_id, e.tournament_id
FROM entries e JOIN tournaments t ON t.id = e.tournament_id WHERE e.excluded = 1;
