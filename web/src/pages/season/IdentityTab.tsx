import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Empty, Popover, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, UndoOutlined, UserAddOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { InstanceDto, PlayerBriefDto } from '../../../../shared/types';
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
  | { kind: 'player'; p: PlayerBriefDto }
  | { kind: 'cand'; p: PlayerBriefDto; why: string; n: number };

/** Lines of one instance: the tournament record, then the assigned player or the candidates (same columns). */
function linesOf(i: InstanceDto): Line[] {
  if (i.player) return [{ kind: 'cr' }, { kind: 'player', p: i.player }];
  return [{ kind: 'cr' }, ...i.candidates.map((c, n) => ({ kind: 'cand' as const, p: c.player, why: c.why, n: n + 1 }))];
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
  if (l.kind === 'cr') return null;
  return pairingConfidence({
    how: l.kind === 'player' ? i.how : null,
    cr: { name: i.crName, lokId: i.lokId, birthYear: i.birthYear, clubId: i.clubId },
    player: l.p,
  });
}

/** Sort key: the assigned player's confidence, or the best candidate's (open instances). */
function instConf(i: InstanceDto): number {
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
  const { data = [], isLoading } = useInstances(id);
  const drawer = usePlayerDrawer();
  const { modal } = App.useApp();
  const batch = useBatch();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [round, setRound] = useState<number>(0);
  const [sort, setSort] = useState<'conf' | 'round'>('conf');

  const assign = useAction((v: { id: number; playerId: number }) => api.post(`/instances/${v.id}/assign`, { playerId: v.playerId }), 'Přiřazeno');
  const newPlayer = useAction((iid: number) => api.post(`/instances/${iid}/new-player`), 'Založen nový hráč');
  const confirm = useAction((ids: number[]) => api.post<{ confirmed: number }>('/instances/confirm', { ids }), (r) => `Potvrzeno ${r.confirmed}`);
  const unconfirm = useAction((iid: number) => api.post(`/instances/${iid}/unconfirm`), 'Vráceno ke kontrole');

  const statusOf = (i: InstanceDto): Filter => (i.player ? (i.status === 'ok' ? 'ok' : 'auto') : 'open');
  const inRound = data.filter((i) => !round || i.firstRound === round);
  const count = (f: Filter) => inRound.filter((i) => f === 'all' || statusOf(i) === f).length;
  // Default view: what needs work first.
  const eff: Filter = filter ?? (count('open') ? 'open' : count('auto') ? 'auto' : 'all');
  const confById = useMemo(() => new Map(data.map((i) => [i.id, instConf(i)])), [data]);
  const rows = inRound
    .filter((i) => eff === 'all' || statusOf(i) === eff)
    .sort((a, b) => (sort === 'conf' ? confById.get(a.id)! - confById.get(b.id)! : 0) || a.firstRound - b.firstRound || a.id - b.id);
  const toConfirm = rows.filter((i) => statusOf(i) === 'auto');
  const sure = toConfirm.filter((i) => confById.get(i.id)! >= 90);

  const rounds = useMemo(() => [...new Set(data.map((i) => i.firstRound))].sort((a, b) => a - b), [data]);
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
        <b>Instance</b> je jedna podoba hráče v turnajích: jméno + LOK + oddíl tak, jak je zapsal pořadatel (kopie záznamu ze Swiss
        Manageru). Řádky se stejnou podobou patří vždy témuž hráči, takže stačí každou instanci ověřit jednou. Nová instance vzniká,
        když se v záznamu něco změní (oddíl, doplněné LOK, oprava jména) – pak ji tady uvidíte znovu. U každé instance je nahoře
        záznam <b>v turnaji</b>, pod ním hráč <b>v evidenci aplikace</b> (nebo návrhy); rozdíly jsou zvýrazněné.
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
          value={round}
          onChange={setRound}
          style={{ width: 220 }}
          options={[{ value: 0, label: 'Všechna kola' }, ...rounds.map((r) => ({ value: r, label: `Nové v ${roundLabel(r)}` }))]}
        />
        <Segmented
          value={sort}
          onChange={(v) => setSort(v as 'conf' | 'round')}
          options={[
            { value: 'conf', label: 'Od nejméně jistých' },
            { value: 'round', label: 'Podle kola' },
          ]}
        />
        <Tooltip title="Potvrdí zobrazená automatická přiřazení s jistotou alespoň 90 %">
          <Button type="primary" icon={<CheckOutlined />} disabled={!sure.length || batch.running} onClick={() => confirmList(sure, 'jistých přiřazení (≥ 90 %)')}>
            Potvrdit jisté ({sure.length})
          </Button>
        </Tooltip>
        <Button icon={<CheckOutlined />} disabled={!toConfirm.length || batch.running} onClick={() => confirmList(toConfirm, 'zobrazených automatických přiřazení')}>
          Potvrdit zobrazené ({toConfirm.length})
        </Button>
      </Space>
      {!isLoading && !rows.length ? (
        <Empty description={eff === 'open' ? 'Nic nečeká na rozhodnutí' : eff === 'auto' ? 'Nic nečeká na kontrolu' : 'Žádné instance'} />
      ) : (
        <Table<InstanceDto>
          size="small"
          rowKey="id"
          className="identity-table"
          loading={isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true }}
          scroll={{ x: 1480 }}
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
                      <span className="muted" style={{ fontSize: 11 }}>z minulé sezóny</span>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: '',
              width: 120,
              render: (_, i) =>
                linesOf(i).map((l, k) => (
                  <Cell key={k}>
                    {l.kind === 'cr' ? (
                      <span className="cmp-label">v turnaji</span>
                    ) : l.kind === 'player' ? (
                      <span className="cmp-label">v evidenci aplikace</span>
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
              title: <Tooltip title="Jak jistě hráč v aplikaci odpovídá záznamu v turnaji (LOK, jméno i na chess.cz, rok narození, oddíl). Podrobnosti po najetí myší.">Jistota</Tooltip>,
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
                  ) : (
                    <Cell key={k} diff={words(l.p.name) !== words(i.crName)} title={l.p.name}>
                      <PlayerName name={l.p.name} gender={l.p.gender} genderSource={l.p.genderSource} onClick={() => drawer.open(l.p.id)} />
                    </Cell>
                  )
                ),
            },
            {
              title: 'LOK',
              width: 80,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const v = l.kind === 'cr' ? i.lokId : l.p.lokId;
                  return (
                    <Cell key={k} diff={l.kind !== 'cr' && (v ?? 0) !== (i.lokId ?? 0)}>
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
                  const v = l.kind === 'cr' ? i.birthYear : l.p.birthYear;
                  return (
                    <Cell key={k} diff={l.kind !== 'cr' && !!v && !!i.birthYear && v !== i.birthYear} title={l.kind === 'cr' && !v ? (i.birthChecked ? 'Na chess-results neuveden' : i.lokId ? 'Registrovaný hráč – rok z chess.cz' : 'Ještě nenačteno z karty hráče (Doplnit údaje hráčů)') : undefined}>
                      <span className="num">{v ?? <span className="muted">{l.kind === 'cr' && !i.birthChecked && !i.lokId ? '…' : '–'}</span>}</span>
                    </Cell>
                  );
                }),
            },
            {
              title: 'Oddíl',
              width: 230,
              render: (_, i) =>
                linesOf(i).map((l, k) => {
                  const v = l.kind === 'cr' ? i.club : l.p.club;
                  return (
                    <Cell key={k} diff={l.kind !== 'cr' && (i.clubId != null && l.p.clubId != null ? i.clubId !== l.p.clubId : words(v) !== words(i.club))} title={v ?? undefined}>
                      {v || <span className="muted">–</span>}
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
                  ) : (
                    <Cell key={k} title={l.kind === 'cand' ? l.why : undefined}>
                      <Space size={4}>
                        <span className="num muted">{rzlId(l.p.id)}</span>
                        <RegionTag value={l.p.eligibility} />
                        {l.p.instances > 1 && <span className="muted" style={{ fontSize: 12 }}>{l.p.instances} instance</span>}
                        {l.kind === 'cand' && <span style={{ fontSize: 12, color: '#ad4e00' }}>{l.why}</span>}
                      </Space>
                    </Cell>
                  )
                ),
            },
            {
              title: 'Proč',
              render: (_, i) => (
                <Space orientation="vertical" size={2} style={{ paddingTop: 4 }}>
                  <span>{i.reason}</span>
                  {i.how && i.how !== 'new' && i.player && <span className="muted" style={{ fontSize: 12 }}>přiřazeno: {INSTANCE_HOW[i.how] ?? i.how}</span>}
                  {i.changes.map((ch) => (
                    <span key={ch} style={{ fontSize: 12, color: '#ad4e00' }}>
                      {ch}
                    </span>
                  ))}
                  {!i.player && !i.candidates.length && <span className="muted">Žádný podobný hráč</span>}
                </Space>
              ),
            },
            {
              title: '',
              width: 130,
              fixed: 'right',
              render: (_, i) => (
                <Space orientation="vertical" size={4}>
                  {statusOf(i) === 'auto' && (
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => confirm.mutate([i.id])}>
                      Potvrdit
                    </Button>
                  )}
                  {(statusOf(i) === 'open' || (i.player && i.player.instances > 1)) && (
                    <Tooltip title="Instance patří hráči, který v evidenci aplikace ještě není">
                      <Button size="small" icon={<UserAddOutlined />} onClick={() => newPlayer.mutate(i.id)}>
                        Nový hráč
                      </Button>
                    </Tooltip>
                  )}
                  {reassign(i)}
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
