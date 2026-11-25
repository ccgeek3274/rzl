// Player identification: a player ("root", players.id = RŽL ID) appears in chess-results tournaments under one or more
// "instances". An instance is a unique combination of normalized name + ID (LOK) + normalized club as written in the
// tournament — in practice one copy of the organizer's Swiss Manager record. Rows with an identical combination belong
// to the same instance, so an assignment is decided (and verified) once per instance, not per row.
//
// Pure logic shared by the worker importer and the replay test (no DB access here).
import { clubKey } from './clubs';
import { nameKey, similarNames, splitCrName } from './text';

export type InstanceStatus = 'open' | 'auto' | 'ok';
/** How an instance got its player: new root, same LOK as the root, LOK already used by another instance of the root, manual decision, pre-instance data. */
export type InstanceHow = 'new' | 'lok' | 'lok-instance' | 'manual' | 'legacy';

export type IdRoot = { id: number; lokId: number | null; nameKey: string; clubKey: string | null };
export type IdInstance = { id: number; playerId: number | null; nameKey: string; lokId: number | null; clubKey: string };
export type IdRow = { nameKey: string; lokId: number | null; clubKey: string };

export type Candidate = { playerId: number; why: string; score: number };
export type Resolution =
  | { kind: 'auto'; playerId: number; how: 'lok' | 'lok-instance'; reason: string }
  | { kind: 'new'; reason: string }
  | { kind: 'open'; reason: string; candidates: Candidate[] };

export function rowIdentity(crName: string, lokId: number | null, clubRaw: string): IdRow {
  const { surname, firstName } = splitCrName(crName);
  return { nameKey: nameKey(surname, firstName), lokId: lokId || null, clubKey: clubKey(clubRaw) };
}

export const instanceKey = (r: IdRow) => `${r.nameKey}|${r.lokId ?? 0}|${r.clubKey}`;

const SIM_RANK = { same: 4, swap: 3, typo: 2, subset: 1 } as const;
const SIM_TEXT = { same: 'stejné jméno', swap: 'prohozené jméno a příjmení', typo: 'podobné jméno (překlep)', subset: 'jméno navíc / chybí' } as const;

/** In-memory index of roots and instances used to resolve a newly seen instance. */
export class IdentityIndex {
  roots = new Map<number, IdRoot>();
  instances = new Map<number, IdInstance>();
  private byKey = new Map<string, IdInstance>();
  private namesOf = new Map<number, Set<string>>();

  constructor(roots: IdRoot[] = [], instances: IdInstance[] = []) {
    for (const r of roots) this.addRoot(r);
    for (const i of instances) this.addInstance(i);
  }

  addRoot(r: IdRoot) {
    this.roots.set(r.id, r);
    (this.namesOf.get(r.id) ?? this.namesOf.set(r.id, new Set()).get(r.id)!).add(r.nameKey);
  }

  addInstance(i: IdInstance) {
    this.instances.set(i.id, i);
    this.byKey.set(instanceKey(i), i);
    this.attach(i);
  }

  setPlayer(instanceId: number, playerId: number | null) {
    const i = this.instances.get(instanceId)!;
    i.playerId = playerId;
    this.attach(i);
  }

  /** The root is now also known under the instance's name; its club follows the latest instance. */
  private attach(i: IdInstance) {
    if (i.playerId == null) return;
    (this.namesOf.get(i.playerId) ?? this.namesOf.set(i.playerId, new Set()).get(i.playerId)!).add(i.nameKey);
    const r = this.roots.get(i.playerId);
    if (r) r.clubKey = i.clubKey;
  }

  find(row: IdRow): IdInstance | undefined {
    return this.byKey.get(instanceKey(row));
  }

  /** Best name similarity between the row and any name the root is known under (its own name + its instances). */
  private similarity(row: IdRow, playerId: number): keyof typeof SIM_RANK | null {
    let best: keyof typeof SIM_RANK | null = null;
    for (const n of this.namesOf.get(playerId) ?? []) {
      const s = similarNames(row.nameKey, n);
      if (s && (!best || SIM_RANK[s] > SIM_RANK[best])) best = s;
    }
    return best;
  }

  /** Players with a similar name, best first. A different LOK is not a reason to skip (the row's LOK may be wrong), only to rank lower. */
  candidates(row: IdRow, exclude?: number | null): Candidate[] {
    const out: Candidate[] = [];
    for (const r of this.roots.values()) {
      if (r.id === exclude) continue;
      const sim = this.similarity(row, r.id);
      if (!sim) continue;
      const sameClub = r.clubKey != null && r.clubKey === row.clubKey;
      const lokClash = row.lokId != null && r.lokId != null && r.lokId !== row.lokId;
      const parts: string[] = [SIM_TEXT[sim], sameClub ? 'stejný oddíl' : 'jiný oddíl'];
      if (lokClash) parts.push(`jiné LOK (${r.lokId})`);
      else if (row.lokId && !r.lokId) parts.push('hráč zatím bez LOK');
      else if (!row.lokId && r.lokId) parts.push(`hráč má LOK ${r.lokId}`);
      out.push({ playerId: r.id, why: parts.join(', '), score: SIM_RANK[sim] * 10 + (sameClub ? 3 : 0) - (lokClash ? 15 : 0) });
    }
    return out.sort((a, b) => b.score - a.score || a.playerId - b.playerId);
  }

  /**
   * Decide a newly seen instance:
   * - LOK of a player in the register and a matching name -> that player (to be checked).
   * - LOK already seen in another instance of a player (e.g. wrong LOK in the tournament, player kept without it) and a matching name -> that player.
   * - otherwise any player with a similar name -> left open for the operator, with candidates.
   * - nobody similar -> new player (to be checked).
   */
  resolve(row: IdRow): Resolution {
    if (row.lokId) {
      const byLok = [...this.roots.values()].find((r) => r.lokId === row.lokId);
      if (byLok) {
        if (this.similarity(row, byLok.id)) return { kind: 'auto', playerId: byLok.id, how: 'lok', reason: `LOK ${row.lokId}` };
        const c = this.candidates(row, byLok.id);
        return {
          kind: 'open',
          reason: `LOK ${row.lokId} má v evidenci aplikace hráč s jiným jménem`,
          candidates: [{ playerId: byLok.id, why: `stejné LOK ${row.lokId}, jiné jméno`, score: 100 }, ...c],
        };
      }
      const viaInstance = new Set<number>();
      for (const i of this.instances.values()) if (i.lokId === row.lokId && i.playerId != null && this.similarity(row, i.playerId)) viaInstance.add(i.playerId);
      if (viaInstance.size === 1) {
        const [pid] = viaInstance;
        return { kind: 'auto', playerId: pid, how: 'lok-instance', reason: `LOK ${row.lokId} už hráč měl v jiném turnaji` };
      }
    }
    const c = this.candidates(row);
    if (c.length) return { kind: 'open', reason: row.lokId ? `LOK ${row.lokId} zatím v evidenci aplikace není, ale je tam podobný hráč` : 'Bez LOK – v evidenci aplikace je podobný hráč', candidates: c };
    return { kind: 'new', reason: row.lokId ? `Nový hráč (LOK ${row.lokId} zatím v evidenci aplikace není)` : 'Nový hráč bez LOK (nikdo podobný v evidenci aplikace)' };
  }
}
