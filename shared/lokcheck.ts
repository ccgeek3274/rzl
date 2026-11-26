// A LOK that chess.cz registers under another name than the tournament wrote: what the evidence says.
// The player who played is always the one named in the tournament (the name was used for pairing and seating);
// the question is only whose LOK it is. Three verdicts:
//   cz        chess.cz is right: the name changed (or, rarely, that person really played) -> player = chess.cz identity
//   cz-error  the LOK is the tournament player's, chess.cz has a wrong name on it -> keep LOK, ignore chess.cz name/gender
//   bad-lok   wrong LOK in the tournament (typo, someone else's record) -> player without LOK
import { fold, guessGender, sameRegisteredName, splitCrName } from './text';

export type LokVerdict = 'cz' | 'cz-error' | 'bad-lok';

export const LOK_VERDICT: Record<LokVerdict, string> = {
  cz: 'Platí chess.cz',
  'cz-error': 'Chyba na chess.cz',
  'bad-lok': 'Chybné LOK v turnaji',
};

export type LokHint = { text: string; favors: LokVerdict[]; weight: number };

export type LokClubMember = { czeId: number; fullName: string; birthYear: number | null };

export type LokHintInput = {
  lokId: number;
  crName: string; // "Surname, First"
  crBirth: number | null; // from the chess-results player card
  cz: { fullName: string; gender: string; birthYear: number | null }; // "Surname First"
  club: LokClubMember[] | null; // members of the LOK's club on chess.cz (null = not loaded)
  laterCzName: boolean; // another tournament wrote this LOK with the chess.cz name
};

export type LokHints = { hints: LokHint[]; suggest: LokVerdict | null; neighbors: LokClubMember[] };

const cmp = (s: string) => fold(s).replace(/[^a-z ]/g, '');

export function lokHints(i: LokHintInput): LokHints {
  const hints: LokHint[] = [];
  const add = (text: string, favors: LokVerdict[], weight: number) => hints.push({ text, favors, weight });
  const cr = splitCrName(i.crName);
  const [czSurname, ...czFirst] = i.cz.fullName.trim().split(/\s+/);
  const crFirst = fold(cr.firstName).split(' ').filter(Boolean);
  const czFirstK = czFirst.map(fold);

  if (i.laterCzName) add('jiný turnaj už s tímto LOK píše jméno z chess.cz', ['cz'], 3);

  const sameFirst = crFirst.length > 0 && crFirst.some((t) => czFirstK.includes(t));
  if (sameFirst && fold(cr.surname) !== fold(czSurname)) add('stejné křestní jméno, jiné příjmení (změna příjmení?)', ['cz'], 2);
  else if (!sameFirst) add('jiné křestní jméno', ['cz-error', 'bad-lok'], 1);

  const g = guessGender(cr.surname);
  const czG = i.cz.gender === 'F' ? 'F' : 'M';
  if (g !== czG) add(`podle jména v turnaji ${g === 'F' ? 'dívka' : 'chlapec'}, na chess.cz ${czG === 'F' ? 'dívka' : 'chlapec'}`, ['cz-error', 'bad-lok'], 2);

  if (i.crBirth && i.cz.birthYear) {
    if (i.crBirth === i.cz.birthYear) add(`rok narození na kartě v turnaji (${i.crBirth}) je stejný jako na chess.cz`, ['cz', 'cz-error'], 2);
    else add(`rok narození na kartě v turnaji ${i.crBirth}, na chess.cz ${i.cz.birthYear}`, ['bad-lok'], 2);
  }

  let neighbors: LokClubMember[] = [];
  if (i.club) {
    const twin = i.club.find((m) => m.czeId !== i.lokId && sameRegisteredName(m.fullName, i.cz.fullName));
    if (twin)
      add(`„${twin.fullName}“ je v oddíle i pod LOK ${twin.czeId}${twin.birthYear ? ` (nar. ${twin.birthYear})` : ''} – záznam LOK ${i.lokId} vypadá jako omylem zkopírovaný`, ['cz-error'], 3);
    // New members of a club are registered in batches in alphabetical order: which name fits between the neighbours?
    const near = i.club.filter((m) => m.czeId !== i.lokId && Math.abs(m.czeId - i.lokId) <= 2).sort((a, b) => a.czeId - b.czeId);
    neighbors = near;
    const prev = near.filter((m) => m.czeId < i.lokId).pop();
    const next = near.find((m) => m.czeId > i.lokId);
    if (prev && next && cmp(prev.fullName) <= cmp(next.fullName)) {
      const fits = (n: string) => cmp(prev.fullName) <= cmp(n) && cmp(n) <= cmp(next.fullName);
      const crFull = `${cr.surname} ${cr.firstName}`;
      if (fits(crFull) && !fits(i.cz.fullName)) add(`v abecední dávce registrací oddílu (${prev.fullName} … ${next.fullName}) sedí jméno z turnaje, ne z chess.cz`, ['cz-error'], 2);
      else if (fits(i.cz.fullName) && !fits(crFull)) add(`v abecední dávce registrací oddílu (${prev.fullName} … ${next.fullName}) sedí jméno z chess.cz`, ['cz', 'bad-lok'], 1);
    }
  }

  const score = (v: LokVerdict) => hints.reduce((s, h) => s + (h.favors.includes(v) ? h.weight : 0), 0);
  const ranked = (['cz', 'cz-error', 'bad-lok'] as const).map((v) => ({ v, s: score(v) })).sort((a, b) => b.s - a.s);
  const suggest = ranked[0].s > 0 && ranked[0].s > ranked[1].s ? ranked[0].v : null;
  return { hints, suggest, neighbors };
}

/** Split a chess.cz full name ("Surname First Middle") for the app. */
export function splitCzName(full: string): { surname: string; firstName: string } {
  const [surname, ...rest] = full.trim().split(/\s+/);
  return { surname, firstName: rest.join(' ') };
}
