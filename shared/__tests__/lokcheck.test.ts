import { describe, expect, it } from 'vitest';
import { lokHints } from '../lokcheck';

// Fictitious club: a batch of new members registered in alphabetical order (LOK 99101–99105).
const club = [
  { czeId: 88001, fullName: 'Malá Jana', birthYear: 2010 },
  { czeId: 99101, fullName: 'Adamec Petr', birthYear: 2016 },
  { czeId: 99102, fullName: 'Hrubý Jan', birthYear: 2017 },
  { czeId: 99103, fullName: 'Malá Jana', birthYear: 2016 }, // the wrong record: copied name of an older member
  { czeId: 99104, fullName: 'Tichý Ondřej', birthYear: 2015 },
  { czeId: 99105, fullName: 'Veselý Adam', birthYear: 2017 },
];

describe('LOK verdict evidence', () => {
  it('a copied name on chess.cz points to an error on chess.cz', () => {
    const r = lokHints({ lokId: 99103, crName: 'Novák, Petr', crBirth: 2016, cz: { fullName: 'Malá Jana', gender: 'F', birthYear: 2016 }, club, laterCzName: false });
    expect(r.suggest).toBe('cz-error');
    expect(r.hints.map((h) => h.text).join('\n')).toMatch(/pod LOK 88001/);
    expect(r.neighbors.map((n) => n.czeId)).toEqual([99101, 99102, 99104, 99105]);
  });
  it('same first name, real later use of the chess.cz name: name change', () => {
    const r = lokHints({ lokId: 99104, crName: 'Novák, Ondřej', crBirth: null, cz: { fullName: 'Tichý Ondřej', gender: 'M', birthYear: 2015 }, club: null, laterCzName: true });
    expect(r.suggest).toBe('cz');
  });
  it('another child with a different birth year: wrong LOK in the tournament', () => {
    const r = lokHints({ lokId: 99105, crName: 'Nováková, Eva', crBirth: 2012, cz: { fullName: 'Veselý Adam', gender: 'M', birthYear: 2017 }, club, laterCzName: false });
    expect(r.suggest).toBe('bad-lok');
  });
});
