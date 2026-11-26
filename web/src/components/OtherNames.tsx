/** Other names a player appears under in tournaments (name change, typos), shown under / next to the name. */
export function OtherNames({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="muted" style={{ fontSize: 12, marginLeft: 6 }} title="Jména, pod kterými hráč vystupuje v turnajích">
      v turnajích i {names.join(', ')}
    </span>
  );
}
