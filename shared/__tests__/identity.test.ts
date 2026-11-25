// Replays season 2025/26 from the stored chess-results HTML (data/seed-2025-26.sql) through the instance-based
// identification, with a simulated operator who decides open instances like the reviewed reference data did.
// Checks that automatic decisions never contradict the reference and that the end result is the same set of players.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseTournament, splitMark } from '../chessresults';
import { IdentityIndex, rowIdentity, type IdInstance } from '../identity';

const ROOT = join(__dirname, '..', '..');
// The seed contains players' personal data: kept out of the public repo, the replay runs only where it exists.
const SEED = join(ROOT, 'data', 'seed-2025-26.sql');

function loadSeed(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(ROOT, 'migrations')).sort()) db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf-8'));
  db.exec(readFileSync(SEED, 'utf-8'));
  return db;
}

type Decision = { tournament: string; crName: string; lok: number | null; club: string; kind: string; reason: string; ok: boolean; note?: string };

function replay() {
  const db = loadSeed();
  const tours = db
    .prepare('SELECT t.id, t.link_name, t.raw_start, t.raw_cross FROM tournaments t JOIN rounds r ON r.id = t.round_id ORDER BY r.ordinal, t.grp')
    .all() as { id: number; link_name: string; raw_start: string; raw_cross: string }[];
  const ref = new Map<string, number>();
  for (const e of db.prepare('SELECT tournament_id, snr, player_id FROM entries').all() as { tournament_id: number; snr: number; player_id: number }[])
    ref.set(`${e.tournament_id}:${e.snr}`, e.player_id);

  const idx = new IdentityIndex();
  const rootOfRef = new Map<number, number>(); // reference player -> simulated root
  const refOfRoot = new Map<number, number>();
  let nextRoot = 1;
  let nextInst = 1;
  const decisions: Decision[] = [];
  let rows = 0;
  const marks: string[] = [];

  const newRoot = (row: ReturnType<typeof rowIdentity>, refId: number) => {
    const id = nextRoot++;
    idx.addRoot({ id, lokId: row.lokId && ![...idx.roots.values()].some((r) => r.lokId === row.lokId) ? row.lokId : null, nameKey: row.nameKey, clubKey: row.clubKey });
    if (!rootOfRef.has(refId)) rootOfRef.set(refId, id);
    refOfRoot.set(id, refId);
    return id;
  };

  for (const t of tours) {
    const parsed = parseTournament(t.raw_start, t.raw_cross);
    for (const p of parsed.players) {
      rows++;
      if (p.mark) marks.push(`${t.link_name}: ${p.name} do ${p.mark}`);
      const refId = ref.get(`${t.id}:${p.snr}`)!;
      const row = rowIdentity(p.name, p.lokId, p.club);
      const existing = idx.find(row);
      if (existing) {
        // Same instance must be the same reference player (else the instance key is too coarse).
        expect(refOfRoot.get(existing.playerId!), `${t.link_name} ${p.name}`).toBe(refId);
        continue;
      }
      const res = idx.resolve(row);
      const inst: IdInstance = { id: nextInst++, playerId: null, ...row };
      const d: Decision = { tournament: t.link_name, crName: p.name, lok: p.lokId, club: p.club, kind: res.kind, reason: res.reason, ok: true };
      if (res.kind === 'auto') {
        inst.playerId = res.playerId;
        d.ok = refOfRoot.get(res.playerId) === refId;
      } else if (res.kind === 'new') {
        // A miss = the reference player already has a root (would end up as a duplicate).
        d.ok = !rootOfRef.has(refId);
        inst.playerId = newRoot(row, refId);
      } else {
        // Operator: pick the reference player's root, or create a new one.
        const target = rootOfRef.get(refId);
        const top = res.candidates[0]?.playerId;
        d.note = target ? (target === top ? 'operátor: 1. návrh' : res.candidates.some((c) => c.playerId === target) ? 'operátor: jiný návrh' : 'operátor: hledá ručně') : 'operátor: nový hráč';
        inst.playerId = target ?? newRoot(row, refId);
        // Operator assignment of a LOK instance to a root without LOK = registration: the root takes the LOK.
        const r = idx.roots.get(inst.playerId)!;
        if (row.lokId && !r.lokId && ![...idx.roots.values()].some((x) => x.lokId === row.lokId)) r.lokId = row.lokId;
      }
      idx.addInstance(inst);
      decisions.push(d);
    }
  }
  return { decisions, rows, roots: idx.roots.size, refPlayers: new Set(ref.values()).size, instances: idx.instances.size, marks, refOfRoot, rootOfRef };
}

describe.skipIf(!existsSync(SEED))('identification replay 2025/26', () => {
  const r = existsSync(SEED) ? replay() : (null as never);

  it('never assigns automatically against the reviewed data', () => {
    const wrong = r.decisions.filter((d) => !d.ok);
    expect(wrong).toEqual([]);
  });

  it('ends with the same players as the reviewed data', () => {
    expect(r.roots).toBe(r.refPlayers);
    expect(r.rootOfRef.size).toBe(r.refPlayers);
  });

  it('summary', () => {
    const by = (k: string) => r.decisions.filter((d) => d.kind === k).length;
    const open = r.decisions.filter((d) => d.kind === 'open');
    const auto = r.decisions.filter((d) => d.kind === 'auto');
    console.log(
      [
        `rows ${r.rows}, instances ${r.instances}, players ${r.roots} (reference ${r.refPlayers})`,
        `new ${by('new')}, auto ${by('auto')}, open ${by('open')}`,
        'AUTO:',
        ...auto.map((d) => `  ${d.tournament.padEnd(14)} ${d.crName} ${d.lok ?? '-'} | ${d.club} | ${d.reason}`),
        'OPEN:',
        ...open.map((d) => `  ${d.tournament.padEnd(14)} ${d.crName} ${d.lok ?? '-'} | ${d.club} | ${d.reason} | ${d.note}`),
        'MARKS:',
        ...r.marks.map((m) => `  ${m}`),
      ].join('\n')
    );
  });
});

describe('promotion mark in the name', () => {
  it('splits "do A"', () => expect(splitMark('Novák, Petr do A')).toEqual({ name: 'Novák, Petr', mark: 'A' }));
});
