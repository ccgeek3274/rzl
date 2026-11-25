-- chess.cz returns gender "Ž" for women; it was stored verbatim. Normalize to M | F.
UPDATE players SET gender = 'F' WHERE gender IN ('Ž', 'Z', 'ž');
UPDATE players SET chesscz = json_set(chesscz, '$.gender', 'F') WHERE chesscz IS NOT NULL AND json_extract(chesscz, '$.gender') IN ('Ž', 'Z', 'ž');
UPDATE chesscz_cache SET payload = json_set(payload, '$.gender', 'F') WHERE payload != 'null' AND json_extract(payload, '$.gender') IN ('Ž', 'Z', 'ž');
-- Registered players get their gender from chess.cz again.
UPDATE players SET gender_source = 'chesscz' WHERE chesscz IS NOT NULL AND gender_source = 'guess';
UPDATE players SET gender = json_extract(chesscz, '$.gender') WHERE chesscz IS NOT NULL AND gender_source = 'chesscz';
-- A dismissed "gender guessed" warning meant "checked": make it a confirmed (manual) value; the warning is now resolved by setting it.
UPDATE players SET gender_source = 'manual'
 WHERE gender_source = 'guess' AND id IN (SELECT CAST(substr(issue_key, 14) AS INTEGER) FROM issue_acks WHERE issue_key LIKE 'gender-guess:%');
DELETE FROM issue_acks WHERE issue_key LIKE 'gender-guess:%';
-- Player created before Latin-1 entities were decoded.
UPDATE players SET surname = replace(surname, '&ouml;', 'ö'), name_key = replace(name_key, '&ouml;', 'o') WHERE surname LIKE '%&ouml;%';
