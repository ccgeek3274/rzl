import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { App, Button, Empty, Input, Popover, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, UndoOutlined, UserAddOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { InstanceDto, LokCheckDto, PlayerBriefDto } from '../../../../shared/types';
import { LOK_VERDICT, type LokVerdict } from '../../../../shared/lokcheck';
import { fold, instId, rzlId } from '../../../../shared/text';
import { pairingConfidence, type Confidence } from '../../../../shared/confidence';
import { api } from '../../lib/api';
import { INSTANCE_HOW, INSTANCE_STATUS } from '../../lib/format';
import { useAction, useInstances, usePlayerDrawer, useSeason } from '../../lib/hooks';
import { useBatch } from '../../components/BatchRunner';
import { PlayerName } from '../../components/PlayerName';
import { PlayerPicker } from '../../components/PlayerPicker';
import { RegionTag } from '../../components/RegionTag';
import { useSeasonId } from './SeasonLayout';

type Filter = 'open' | 'auto' | 'ok' | 'all';

export function InstanceStatusTag({ status }: { status: string }) {
  const s = INSTANCE_STATUS[status];
  return (
    <Tooltip title={s?.hint}>
      <Tag color={s?.color} style={{ marginInlineEnd: 0 }}>
        {s?.label ?? status}
      </Tag>
    </Tooltip>
  );
}

type Line =
  | { kind: 'cr' }
  | { kind: 'cz' }
  | { kind: 'player'; p: PlayerBriefDto }
  | { kind: 'cand'; p: PlayerBriefDto; why: string; n: number; sameRound: string | null };

/** Lines of one instance: the tournament record, then the assigned player or the candidates (same columns). */
function linesOf(i: InstanceDto): Line[] {
  // An existing player is shown as the app had them before this tournament (what the tournament record is compared to).
  if (i.player) return [{ kind: 'cr' }, { kind: 'player', p: i.before ? { ...i.player, lokId: i.before.lokId, club: i.before.club, clubId: i.before.clubId } : i.player }];
  // Whose is the LOK? decided first (the record on chess.cz below the tournament's).
  if (i.lokCheck) return [{ kind: 'cr' }, { kind: 'cz' }];
  return [{ kind: 'cr' }, ...i.candidates.map((c, n) => ({ kind: 'cand' as const, p: c.player, why: c.why, n: n + 1, sameRound: c.sameRound }))];
}

const words = (s: string | null | undefined) =>
  fold(s ?? '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

/** Pairing confidence of a line (assigned player or candidate) against the tournament record. */
function confOf(i: InstanceDto, l: Line): Confidence | null {
  if (l.kind === 'cr' || l.kind === 'cz') return null;
  return pairingConfidence({
    how: l.kind === 'player' ? i.how : null,
    sameRound: l.kind === 'cand' ? l.sameRound : null,
    cr: { name: i.crName, lokId: i.lokId, birthYear: i.birthYear, clubId: i.clubId },
    player: l.p,
  });
}

/** Sort key: the assigned player's confidence, or the best candidate's (open instances). */
function instConf(i: InstanceDto): number {
  if (i.lokCheck) return 0;
  const ls = linesOf(i).slice(1);
  return ls.length ? Math.max(...ls.map((l) => confOf(i, l)!.score)) : 0;
}

const LEVEL = { high: { color: 'green', label: 'jisté' }, medium: { color: 'gold', label: 'ověřit' }, low: { color: 'red', label: 'nejisté' } } as const;

function ConfidenceTag({ c }: { c: Confidence }) {
  return (
    <Tooltip
      title={
        <div>
          {c.factors.map((f) => (
            <div key={f.text}>
              {f.text}
              {f.delta ? ` (${f.delta > 0 ? '+' : ''}${f.delta})` : ''}
            </div>
          ))}
        </div>
      }
    >
      <Tag color={LEVEL[c.level].color} style={{ marginInlineEnd: 0, cursor: 'help' }}>
        {c.score} %
      </Tag>
    </Tooltip>
  );
}

function verdictHint(v: LokVerdict, i: InstanceDto): string {
  const c = i.lokCheck!;
  if (v === 'cz')
    return `Výsledky patří hráči „${c.cz.fullName}“: změna jména (turnaj má staré jméno), výjimečně opravdu hrála tato osoba. Jméno, pohlaví a rok narození z chess.cz.`;
  if (v === 'cz-error')
    return `LOK ${c.lokId} patří hráči z turnaje (${i.crName}), chess.cz má u něj chybné jméno. LOK zůstane (Elo, registrace), jméno z turnaje; jméno a pohlaví z chess.cz se nepoužijí. Chybu nahlaste k opravě.`;
  return `LOK ${c.lokId} je v turnaji chybné (překlep, cizí záznam). Hráč z turnaje bude veden bez LOK; instance si LOK pamatuje, aby další kola se stejnou chybou přiřadila sama.`;
}

/** Evidence for the LOK verdict: what supports which option. */
function LokEvidence({ c }: { c: LokCheckDto }) {
  return (
    <div style={{ fontSize: 12, maxWidth: 420 }}>
      {c.hints.map((h) => (
        <div key={h.text}>
          • {h.text} <span style={{ color: '#8c8c8c' }}>→ {h.favors.map((v) => LOK_VERDICT[v]).join(' / ')}</span>
        </div>
      ))}
      {!c.clubLoaded && <div className="muted">Seznam oddílu z chess.cz zatím nenačten („Doplnit údaje hráčů“).</div>}
      {c.neighbors.length > 0 && (
        <div className="muted">
          Sousední LOK v oddíle: {c.neighbors.map((n) => `${n.czeId} ${n.fullName}${n.birthYear ? ` (${n.birthYear})` : ''}`).join(', ')}
        </div>
      )}
    </div>
  );
}

/** Cell of a line: differences against the tournament record are highlighted. */
function Cell({ diff, title, children }: { diff?: boolean; title?: string; children: ReactNode }) {
  return (
    <div className="cmp-line" title={title}>
      {diff ? <span className="cmp-diff">{children}</span> : children}
    </div>
  );
}

export function IdentityTab() {
  const id = useSeasonId();
  const { data: season } = useSeason(id);
  const { data = [], isLoading, isFetching } = useInstances(id);
  const drawer = usePlayerDrawer();
  const { modal } = App.useApp();
  const batch = useBatch();
  const [filter, setFilter] = useState<Filter | null>(null);
  // null = follow the latest round (until the operator picks one); 0 = all rounds.
  const [round, setRound] = useState<number | null>(null);
  const [sort, setSort] = useState<'conf' | 'round'>('conf');
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  useEffect(() => {
    const v = sp.get('q');
    if (v != null) setQ(v);
  }, [sp]);

  const assign = useAction(
    (v: { id: number; playerId: number }) => api.post<{ note: string | null }>(`/instances/${v.id}/assign`, { playerId: v.playerId }),
    (r) => r.note ?? 'Přiřazeno',
  );
  const newPlayer = useAction((iid: number) => api.post(`/instances/${iid}/new-player`), 'Založen nový hráč');
  const confirm = useAction(
    (ids: number[]) => api.post<{ confirmed: number }>('/instances/confirm', { ids }),
    (r) => `Potvrzeno ${r.confirmed}`,
  );
  const verdict = useAction(
    (v: { id: number; verdict: LokVerdict }) => api.post<{ message: string }>(`/instances/${v.id}/lok-verdict`, { verdict: v.verdict }),
    (r) => r.message,
  );
  const unconfirm = useAction((iid: number) => api.post(`/instances/${iid}/unconfirm`), 'Vráceno ke kontrole');

  const statusOf = (i: InstanceDto): Filter => (i.player ? (i.status === 'ok' ? 'ok' : 'auto') : 'open');
  const rounds = useMemo(() => [...new Set(data.map((i) => i.firstRound))].sort((a, b) => a - b), [data]);
  const latestRound = rounds.length ? rounds[rounds.length - 1] : 0;
  const effRound = round ?? latestRound;
  const inRoundOf = (r: number) => data.filter((i) => !r || i.firstRound === r);
  const inRound = inRoundOf(effRound);
  const countIn = (list: InstanceDto[], f: Filter) => list.filter((i) => f === 'all' || statusOf(i) === f).length;
  const count = (f: Filter) => countIn(inRound, f);
  const firstWithWorkIn = (list: InstanceDto[]): Filter => (countIn(list, 'open') ? 'open' : countIn(list, 'auto') ? 'auto' : 'all');
  // Default view (the first one with something to do) is chosen on fresh data – when the tab opens and whenever a
  // tournament was imported (newest row grows): then the round switches to that tournament's round. Otherwise round and
  // view stay where the operator is, even when the list empties after the last decision.
  const firstWithWork = firstWithWorkIn(inRound);
  const eff: Filter = filter ?? firstWithWork;
  const newest = data.reduce<{ entryId: number; round: number }>((m, i) => {
    for (const r of i.rows) if (r.entryId > m.entryId) m = { entryId: r.entryId, round: r.round };
    return m;
  }, { entryId: 0, round: 0 });
  const [seenMax, setSeenMax] = useState(0);
  useEffect(() => {
    if (isFetching || !data.length) return;
    if (filter === null || newest.entryId > seenMax) {
      let target = effRound;
      if (seenMax && newest.entryId > seenMax) {
        target = newest.round;
        setRound(target === latestRound ? null : target);
      }
      setFilter(firstWithWorkIn(inRoundOf(target)));
      setSeenMax(newest.entryId);
    }
  }, [isFetching, data, filter, newest.entryId, seenMax, effRound, latestRound]); // eslint-disable-line react-hooks/exhaustive-deps
  const confById = useMemo(() => new Map(data.map((i) => [i.id, instConf(i)])), [data]);
  // Search goes through all rounds and states (to find an old decision and change it).
  const qk = fold(q.trim());
  const matches = (i: InstanceDto) =>
    [i.crName, i.club, i.player?.name, i.player?.czName, ...i.candidates.map((c) => c.player.name)].some((x) => x && fold(x).includes(qk)) ||
    String(i.lokId ?? '').includes(q.trim()) ||
    instId(i.id).toLowerCase() === q.trim().toLowerCase() ||
    (i.player != null && rzlId(i.player.id).toLowerCase() === q.trim().toLowerCase());
  const rows = (qk ? data.filter(matches) : inRound.filter((i) => eff === 'all' || statusOf(i) === eff))
    .sort((a, b) => (sort === 'conf' ? confById.get(a.id)! - confById.get(b.id)! : 0) || a.firstRound - b.firstRound || a.id - b.id);
  const toConfirm = rows.filter((i) => statusOf(i) === 'auto');
  const sure = toConfirm.filter((i) => confById.get(i.id)! >= 90);

  const roundLabel = (n: number) => {
    const r = season?.rounds.find((x) => x.ordinal === n);
    return r ? `${n}. kolo – ${r.place}` : `${n}. kolo`;
  };

  const confirmList = (list: InstanceDto[], what: string) =>
    modal.confirm({
      title: `Potvrdit ${list.length} ${what}?`,
      content: 'Potvrzujete, že každá z těchto instancí patří uvedenému hráči. Potvrzení jde u instance vrátit.',
      okText: 'Potvrdit',
      onOk: () => batch.run('Potvrzuji', [{ label: `${list.length} instancí`, run: () => api.post('/instances/confirm', { ids: list.map((i) => i.id) }) }]),
    });

  const reassign = (i: InstanceDto) => (
    <Popover
      trigger="click"
      title={`Přiřadit ${instId(i.id)} jinému hráči`}
      content={
        <Space orientation="vertical">
          <PlayerPicker exclude={i.player?.id} onSelect={(pid) => assign.mutate({ id: i.id, playerId: pid })} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Přesune všechny řádky této instance (i v dalších turnajích).
          </Typography.Text>
        </Space>
      }
    >
      <Button size="small" icon={<UserSwitchOutlined />}>
        Jiný hráč…
      </Button>
    </Popover>
  );

  return (
    <>
      {batch.view}
      <Typography.Paragraph type="secondary" style={{ maxWidth: 900 }}>
        <b>Instance</b> je jedna podoba hráče v turnajích: jméno + LOK + oddíl tak, jak je zapsal pořadatel (kopie záznamu ze Swiss Manageru). Řádky se stejnou
        podobou patří vždy témuž hráči, takže stačí každou instanci ověřit jednou. Nová instance vzniká, když se v záznamu něco změní (oddíl, doplněné LOK,
        oprava jména) – pak ji tady uvidíte znovu. U každé instance je nahoře záznam <b>v turnaji</b>, pod ním hráč <b>v evidenci aplikace</b> (nebo návrhy);
        rozdíly jsou zvýrazněné.
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={eff}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'open', label: `K rozhodnutí (${count('open')})` },
            { value: 'auto', label: `Ke kontrole (${count('auto')})` },
            { value: 'ok', label: `Potvrzeno (${count('ok')})` },
            { value: 'all', label: `Vše (${count('all')})` },
          ]}
        />
        <Select
          value={effRound}
          onChange={setRound}
          style={{ width: 220 }}
          options={[{ value: 0, label: 'Všechna kola' }, ...rounds.map((r) => ({ value: r, label: `Nové v ${roundLabel(r)}` }))]}
        />
        <Input.Search
          allowClear
          placeholder="Hledat jméno v turnaji / hráče / LOK / I0123"
          style={{ width: 300 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Segmented
          value={sort}
          onChange={(v) => setSort(v as 'conf' | 'round')}
          options={[
            { value: 'conf', label: 'Od nejméně jistých' },
            { value: 'round', label: 'Podle kola' },
          ]}
        />
        {eff === 'auto' && !qk && (
          <>
            <Tooltip title="Potvrdí zobrazená automatická přiřazení s jistotou alespoň 90 %">
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!sure.length || batch.running}
                onClick={() => confirmList(sure, 'jistých přiřazení (≥ 90 %)')}
              >
                Potvrdit jisté ({sure.length})
              </Button>
            </Tooltip>
            <Button
              icon={<CheckOutlined />}
              disabled={!toConfirm.length || batch.running}
              onClick={() => confirmList(toConfirm, 'zobrazených automatických přiřazení')}
            >
              Potvrdit zobrazené ({toConfirm.length})
            </Button>
          </>
        )}
      </Space>
      {qk && (
        <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
          Hledání prochází všechna kola a stavy ({rows.length} nalezeno). U potvrzené instance lze přiřazení změnit nebo vrátit ke kontrole.
        </Typography.Paragraph>
      )}
      {!isLoading && !rows.length ? (
        <Empty
          description={
            qk
              ? 'Nic nenalezeno'
              : eff === 'open'
              ? `Nic nečeká na rozhodnutí${count('auto') ? ` – pokračujte na „Ke kontrole (${count('auto')})“` : ''}`
              : eff === 'auto'
                ? 'Nic nečeká na kontrolu'
                : 'Žádné instance'
          }
        />
      ) : (
        <Table<InstanceDto>
          size="small"
          rowKey="id"
          className="identity-table"
          loading={isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true }}
          scroll={{ x: 1560 }}
          columns={[
            {
              title: 'Instance',
              width: 110,
              render: (_, i) => (
                <Space orientation="vertical" size={2}>
                  <span className="num">{instId(i.id)}</span>
                  <InstanceStatusTag status={statusOf(i)} />
                  {i.recycled && (
                    <Tooltip title="Instance existuje z dřívější sezóny">
                      <span className="muted" style={{ fontSize: 11 }}>
                        z minulé sezóny
                      </span>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: '',
              width: 150,
              render: (_, i) =>
                linesOf(i).map((l, k) => (
                  <Cell key={k}>
                    {l.kind === 'cr' ? (
                      <span className="cmp-label">v turnaji</span>
                    ) : l.kind === 'cz' ? (
                      <span className="cmp-label">na chess.cz</span>
                    ) : l.kind === 'player' ? (
                      <span className="cmp-label">{i.before && !i.before.created ? `v evidenci před ${i.firstRound}. kolem` : (i.before?.created || i.how === 'new') && !i.recycled ? 'do evidence aplikace' : 'v evidenci aplikace'}</span>
                    ) : l.sameRound ? (
                      <Tooltip title={`Hraje ve stejném kole (${l.sameRound}) – nemůže to být tentýž hráč`}>
                        <span style={{ fontSize: 12, color: '#cf1322' }}>jiný hráč ({l.sameRound})</span>
                      </Tooltip>
                    ) : (
                      <Tooltip title={l.why}>
                        <Button size="small" type="primary" ghost onClick={() => assign.mutate({ id: i.id, playerId: l.p.id })}>
                          Je to on(a)
                        </Button>
                      </Tooltip>
                    )}
                  </Cell>
                )),
            },
            {
              title: (
                <Tooltip title="Jak jistě hráč v aplikaci odpovídá záznamu v turnaji (LOK, jméno i na chess.cz, rok narození, oddíl). Podrobnosti po najetí myší.">
                  Jistota
                </Tooltip>
              ),
              width: 76,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const c = confOf(i, l);
                  return <Cell key={k}>{c ? <ConfidenceTag c={c} /> : null}</Cell>;
                }),
            },
            {
              title: 'Jméno',
              width: 230,
              render: (_, i) =>
                linesOf(i).map((l, k) =>
                  l.kind === 'cr' ? (
                    <Cell key={k} title={i.crName}>
                      {i.crName}
                    </Cell>
                  ) : l.kind === 'cz' ? (
                    <Cell key={k} diff={words(i.lokCheck!.cz.fullName) !== words(i.crName)} title={i.lokCheck!.cz.fullName}>
                      {i.lokCheck!.cz.fullName} <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>{i.lokCheck!.cz.gender === 'F' ? 'D' : 'H'}</Tag>
                    </Cell>
                  ) : (
                    <Cell key={k} diff={words(l.p.name) !== words(i.crName)} title={l.p.name}>
                      <PlayerName name={l.p.name} gender={l.p.gender} genderSource={l.p.genderSource} onClick={() => drawer.open(l.p.id)} />
                    </Cell>
                  ),
                ),
            },
            {
              title: 'LOK',
              width: 80,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const v = l.kind === 'cr' || l.kind === 'cz' ? i.lokId : l.p.lokId;
                  return (
                    <Cell key={k} diff={l.kind !== 'cr' && l.kind !== 'cz' && (v ?? 0) !== (i.lokId ?? 0)}>
                      <span className="num">{v ?? <span className="muted">–</span>}</span>
                    </Cell>
                  );
                }),
            },
            {
              title: 'Nar.',
              width: 64,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const v = l.kind === 'cr' ? i.birthYear : l.kind === 'cz' ? i.lokCheck!.cz.birthYear : l.p.birthYear;
                  return (
                    <Cell
                      key={k}
                      diff={l.kind !== 'cr' && !!v && !!i.birthYear && v !== i.birthYear}
                      title={
                        l.kind === 'cr' && !v
                          ? i.birthChecked
                            ? 'Na chess-results neuveden'
                            : i.lokId && !i.lokCheck
                              ? 'Registrovaný hráč – rok z chess.cz'
                              : 'Ještě nenačteno z karty hráče (Doplnit údaje hráčů)'
                          : undefined
                      }
                    >
                      <span className="num">
                        {v ?? <span className="muted">{l.kind === 'cr' && !i.birthChecked && (!i.lokId || i.lokCheck) ? '…' : '–'}</span>}
                      </span>
                    </Cell>
                  );
                }),
            },
            {
              title: (
                <Tooltip title="Nahoře oddíl tak, jak ho napsal pořadatel; dole krátký název oddílu v aplikaci (různé zápisy téhož oddílu se přiřazují na záložce Oddíly a region). Jiný oddíl je zvýrazněný.">
                  Oddíl
                </Tooltip>
              ),
              width: 230,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const v = l.kind === 'cr' ? i.club : l.kind === 'cz' ? i.lokCheck!.cz.clubName : l.p.club;
                  const app = l.kind === 'player' || l.kind === 'cand';
                  const diff = app ? (i.clubId != null && l.p.clubId != null ? i.clubId !== l.p.clubId : words(v) !== words(i.club)) : false;
                  const same = app && !diff && !!v;
                  return (
                    <Cell key={k} diff={diff} title={same ? `${v} – stejný oddíl jako v turnaji (${i.club})` : (v ?? undefined)}>
                      {v || <span className="muted">–</span>}
                      {same && <span style={{ color: '#389e0d', fontSize: 12, marginLeft: 6 }}>✓ stejný oddíl</span>}
                    </Cell>
                  );
                }),
            },
            {
              title: 'Turnaje / hráč',
              width: 220,
              render: (_, i) =>
                linesOf(i).map((l, k) =>
                  l.kind === 'cr' ? (
                    <Cell key={k}>
                      <Space size={2}>
                        {i.rows.map((r) => (
                          <Tooltip key={r.entryId} title={`${r.linkName}, st. č. ${r.snr}, ${r.rank}. místo${r.manual ? ' – řádek přiřazen ručně jinak' : ''}`}>
                            <Link to={`/s/${id}/turnaje/${r.tournamentId}`}>
                              <Tag style={{ marginInlineEnd: 0, textDecoration: r.manual ? 'line-through' : undefined }}>
                                {r.round}
                                <span className={`grp-${r.grp}`}>{r.grp}</span>
                                {r.mark && ` → ${r.mark}`}
                              </Tag>
                            </Link>
                          </Tooltip>
                        ))}
                      </Space>
                    </Cell>
                  ) : l.kind === 'cz' ? (
                    <Cell key={k}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        Elo {i.lokCheck!.cz.czeStdElo || '–'} / rapid {i.lokCheck!.cz.czeRapidElo || '–'}
                        {i.lokCheck!.cz.registration ? ` · ${i.lokCheck!.cz.registration}` : ''}
                      </span>
                    </Cell>
                  ) : (
                    <Cell key={k} title={l.kind === 'cand' ? l.why : undefined}>
                      <Space size={4}>
                        <span className="num muted">{rzlId(l.p.id)}</span>
                        <RegionTag value={l.p.eligibility} />
                        {l.p.instances > 1 && (
                          <span className="muted" style={{ fontSize: 12 }}>
                            {l.p.instances} instance
                          </span>
                        )}
                        {l.kind === 'cand' && <span style={{ fontSize: 12, color: '#ad4e00' }}>{l.why}</span>}
                      </Space>
                    </Cell>
                  ),
                ),
            },
            {
              title: 'Proč',
              render: (_, i) => (
                <Space orientation="vertical" size={2} style={{ paddingTop: 4 }}>
                  {i.lokCheck ? (
                    <b>
                      Komu patří LOK {i.lokCheck.lokId}? Na chess.cz je pod jménem „{i.lokCheck.cz.fullName}“.
                    </b>
                  ) : (
                    <span>{i.reason}</span>
                  )}
                  {i.how && i.how !== 'new' && i.player && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      přiřazeno: {INSTANCE_HOW[i.how] ?? i.how}
                    </span>
                  )}
                  {i.changes.map((ch) => (
                    <span key={ch} style={{ fontSize: 12, color: '#ad4e00' }}>
                      {ch}
                    </span>
                  ))}
                  {i.lokCheck ? <LokEvidence c={i.lokCheck} /> : !i.player && !i.candidates.length && <span className="muted">Žádný podobný hráč</span>}
                </Space>
              ),
            },
            {
              title: '',
              width: 180,
              fixed: 'right',
              render: (_, i) => (
                <Space orientation="vertical" size={4}>
                  {i.lokCheck &&
                    (['cz-error', 'bad-lok', 'cz'] as const).map((v) => (
                      <Tooltip key={v} placement="left" title={verdictHint(v, i)}>
                        <Button size="small" type={i.lokCheck!.suggest === v ? 'primary' : 'default'} onClick={() => verdict.mutate({ id: i.id, verdict: v })}>
                          {LOK_VERDICT[v]}
                          {i.lokCheck!.suggest === v ? ' ★' : ''}
                        </Button>
                      </Tooltip>
                    ))}
                  {i.lokCheck && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      ★ doporučeno podle stop
                    </span>
                  )}
                  {statusOf(i) === 'auto' && (
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => confirm.mutate([i.id])}>
                      Potvrdit
                    </Button>
                  )}
                  {!i.lokCheck && (statusOf(i) === 'open' || (i.player && i.player.instances > 1)) && (
                    <Tooltip
                      title={
                        !i.player && i.lokId && i.candidates.some((c) => c.player.lokId === i.lokId)
                          ? `LOK ${i.lokId} v turnaji je chybné: vznikne nový hráč bez LOK (instance si LOK pamatuje, další turnaje s ním ho najdou)`
                          : 'Instance patří hráči, který v evidenci aplikace ještě není'
                      }
                    >
                      <Button
                        size="small"
                        type={!i.player && i.candidates.length > 0 && i.candidates.every((c) => c.sameRound) ? 'primary' : 'default'}
                        icon={<UserAddOutlined />}
                        onClick={() => newPlayer.mutate(i.id)}
                      >
                        Nový hráč
                      </Button>
                    </Tooltip>
                  )}
                  {!i.lokCheck && reassign(i)}
                  {statusOf(i) === 'ok' && (
                    <Button size="small" type="text" icon={<UndoOutlined />} onClick={() => unconfirm.mutate(i.id)}>
                      Ke kontrole
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
