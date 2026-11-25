// How sure an instance ↔ player pairing is (shown in Párování so the operator sees at a glance what needs a look).
import { fold, similarNames } from './text';

export type ConfidenceInput = {
  how: string | null; // InstanceHow; null for a candidate of an open instance
  cr: { name: string; lokId: number | null; birthYear: number | null; clubId: number | null };
  player: { name: string; lokId: number | null; birthYear: number | null; clubId: number | null; czName: string | null };
};

export type Confidence = { score: number; level: 'high' | 'medium' | 'low'; factors: { text: string; delta: number }[] };

const key = (s: string) =>
  fold(s)
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

const NAME_PENALTY = { same: 0, swap: 5, typo: 15, subset: 20 } as const;

/**
 * Score 0–100 from what can be compared: LOK, name (incl. the name on chess.cz for the LOK), birth year, club.
 * A new player is compared with "nobody similar exists", so only the strength of its identity counts (LOK or not).
 */
export function pairingConfidence(i: ConfidenceInput): Confidence {
  const f: Confidence['factors'] = [];
  const add = (text: string, delta: number) => f.push({ text, delta });
  const { cr, player: p } = i;

  if (i.how === 'new') {
    if (cr.lokId) add(`nový hráč s LOK ${cr.lokId}, nikdo podobný v evidenci aplikace`, 0);
    else add('nový hráč bez LOK – identitu nelze ověřit, jen nikdo podobný v evidenci aplikace', -20);
  } else {
    // LOK
    if (cr.lokId && p.lokId === cr.lokId) add('stejné LOK', 0);
    else if (cr.lokId && p.lokId) add(`jiné LOK (${cr.lokId} × ${p.lokId})`, -45);
    else if (cr.lokId && !p.lokId) add('hráč v aplikaci zatím bez LOK (převezme ho)', -15);
    else if (!cr.lokId && p.lokId) add('v turnaji bez LOK', -20);
    else add('oba bez LOK – shoda jen podle jména', -30);
    if (i.how === 'lok-instance') add('LOK hráč už měl v jiném turnaji', 0);
    // Name
    const sim = similarNames(key(cr.name), key(p.name));
    if (sim && sim !== 'same') add(sim === 'swap' ? 'jméno v jiném pořadí' : sim === 'typo' ? 'jméno s překlepem' : 'jméno navíc / chybí', -NAME_PENALTY[sim]);
    else if (!sim) add('jiné jméno', -35);
  }
  // Name registered on chess.cz under the LOK (a wrong LOK in the tournament shows here).
  if (cr.lokId && p.lokId === cr.lokId && p.czName) {
    const s = similarNames(key(cr.name), key(p.czName));
    if (!s) add(`na chess.cz je LOK ${cr.lokId} „${p.czName}“`, -25);
  }
  // Birth year (tournament card vs. app); a new player was created from this very record.
  if (i.how !== 'new' && cr.birthYear && p.birthYear) {
    if (cr.birthYear !== p.birthYear) add(`jiný rok narození (${cr.birthYear} × ${p.birthYear})`, -35);
    else if (!cr.lokId) add('stejný rok narození', +10);
  }
  // Club (a change of club is common, so it costs little)
  if (i.how !== 'new' && cr.clubId != null && p.clubId != null) {
    if (cr.clubId === p.clubId) add('stejný oddíl', +5);
    else add('jiný oddíl', -5);
  }
  const score = Math.max(0, Math.min(100, 100 + f.reduce((s, x) => s + x.delta, 0)));
  return { score, level: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low', factors: f };
}
