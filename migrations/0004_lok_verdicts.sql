-- Operator's verdict on a LOK that chess.cz registers under another name than the tournament wrote
-- (decided once per LOK on the "Párování" tab, see CLAUDE.md).
CREATE TABLE lok_verdicts (
  lok_id     INTEGER PRIMARY KEY,
  verdict    TEXT NOT NULL,            -- cz (chess.cz is right: name change / that person played) | cz-error (LOK belongs to the tournament's player, chess.cz has a wrong name) | bad-lok (wrong LOK in the tournament)
  cr_name    TEXT NOT NULL,            -- tournament name the verdict was made for
  cz_name    TEXT NOT NULL,            -- name on chess.cz at that time
  created_at INTEGER NOT NULL
);
