import { describe, expect, it } from 'vitest';
import { pairingConfidence } from '../confidence';

const cr = { name: 'Novák, Petr', lokId: 99001, birthYear: null, clubId: 4 };
const p = { name: 'Novák Petr', lokId: 99001, birthYear: 2012, clubId: 4, czName: 'Novák Petr' };

describe('pairingConfidence', () => {
  it('new player with LOK is sure', () => expect(pairingConfidence({ how: 'new', cr, player: p }).level).toBe('high'));
  it('new player whose LOK has another name on chess.cz needs a look', () =>
    expect(pairingConfidence({ how: 'new', cr, player: { ...p, czName: 'Dvořák Petr' } }).level).toBe('medium'));
  it('new player without LOK is not sure', () =>
    expect(pairingConfidence({ how: 'new', cr: { ...cr, lokId: null }, player: { ...p, lokId: null } }).level).toBe('medium'));
  it('same LOK, same name, same club', () => expect(pairingConfidence({ how: 'lok', cr, player: p }).score).toBe(100));
  it('candidate without LOK by name only is low', () =>
    expect(pairingConfidence({ how: null, cr: { ...cr, lokId: null, clubId: 9 }, player: { ...p, lokId: null } }).level).toBe('low'));
  it('same name and birth year without LOK is medium', () =>
    expect(pairingConfidence({ how: null, cr: { ...cr, lokId: null, birthYear: 2012 }, player: { ...p, lokId: null } }).level).toBe('medium'));
  it('different birth year is low', () =>
    expect(pairingConfidence({ how: null, cr: { ...cr, lokId: null, birthYear: 2015 }, player: { ...p, lokId: null } }).level).toBe('low'));
});
