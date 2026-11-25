// Short club names as printed in the official RŽL sheets ("Klub šachistů Říčany 1925" -> "Říčany").
// Only a display default for newly seen clubs; the user can rename clubs in the app.
import { fold } from './text';

const SHORT: [RegExp, string][] = [
  [/ricany/, 'Říčany'],
  [/vlasim/, 'Vlašim'],
  [/brodce/, 'Brodce'],
  [/sedlcany/, 'Sedlčany'],
  [/stamat/, 'ŠŠ Stamat'],
  [/sazava|kavalier/, 'Sázava'],
  [/zvole|medvedi/, 'Zvole'],
  [/stribrna skalice|st\.? ?skalice/, 'St.Skalice'],
  [/porici/, 'Poříčí n.S.'],
  [/jilove/, 'Jílové'],
  [/tynec/, 'Týnec n.S.'],
  [/cercany/, 'Čerčany'],
  [/chocerady/, 'Chocerady'],
  [/benesov/, 'Benešov'],
];

export function clubShortName(raw: string): string {
  const f = fold(raw);
  for (const [re, short] of SHORT) if (re.test(f)) return short;
  return raw.trim();
}

/** Key under which different spellings of one club collapse ("Tj Spartak Vlašim" == "TJ Spartak Vlašim"). */
export function clubKey(raw: string): string {
  return fold(raw).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}
