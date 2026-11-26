import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popover, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { EditOutlined, ExportOutlined, ReloadOutlined, UserAddOutlined, UserSwitchOutlined } from '@ant-design/icons';
import type { EntryDto } from '../../../../shared/types';
import { api } from '../../lib/api';
import { crUrl, useAction, useIsAdmin, usePlayerDrawer, useTournament } from '../../lib/hooks';
import { ChevronExpand } from '../../components/ExpandIcon';
import { fmtDate, fmtNum, fmtTs } from '../../lib/format';
import { PlayerPicker } from '../../components/PlayerPicker';
import { RegionTag } from '../../components/RegionTag';
import { PlayerName } from '../../components/PlayerName';
import { instId, rzlId } from '../../../../shared/text';
import { InstanceStatusTag } from './IdentityTab';
import { useSeasonId } from './SeasonLayout';

function GamesList({ e, bySnr }: { e: EntryDto; bySnr: Map<number, EntryDto> }) {
  return (
    <Space wrap size={[12, 4]}>
      {e.games.map((g, i) => {
        if (g.kind === 'none') return null;
        if (g.kind === 'bye')
          return (
            <span key={i}>
              {i + 1}. kolo: volno ({g.score})
            </span>
          );
        const o = bySnr.get(g.opp);
        const res = g.score === 0.5 ? '½' : String(g.score);
        return (
          <span key={i}>
            {i + 1}. {g.color === 'w' ? '○' : '●'} {o?.crName ?? `#${g.opp}`} <span className="muted">({o?.rtg ?? '–'})</span> <b>{res}</b>
            {g.kind === 'forfeit' && <Tag style={{ marginLeft: 4 }}>kontumace</Tag>}
          </span>
        );
      })}
    </Space>
  );
}

export function TournamentPage() {
  const seasonId = useSeasonId();
  const tid = Number(useParams().tournamentId);
  const { data, isLoading } = useTournament(tid);
  const drawer = usePlayerDrawer();
  const admin = useIsAdmin();
  const [editing, setEditing] = useState<EntryDto | null>(null);
  const [rowOnly, setRowOnly] = useState(false);
  const [form] = Form.useForm();
  const refetch = useAction(() => api.post<{ players: number; created: number }>(`/tournaments/${tid}/fetch`), (r) => `Staženo znovu (${r.players} hráčů)`);
  const patch = useAction((v: { id: number; body: Record<string, unknown> }) => api.patch(`/entries/${v.id}`, v.body), 'Uloženo');
  const newPlayer = useAction((id: number) => api.post(`/entries/${id}/new-player`), 'Založen nový hráč');

  const t = data?.tournament;
  const bySnr = new Map((data?.entries ?? []).map((e) => [e.snr, e]));

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start" wrap>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              <Link to={`/s/${seasonId}/turnaje`}>Turnaje</Link> / {data?.round.ordinal}. kolo {data?.round.place} – turnaj <span className={`grp-${t?.grp}`}>{t?.grp}</span>
            </Typography.Title>
            <Typography.Text type="secondary">{t?.title}</Typography.Text>
          </div>
          <Space>
            <Button icon={<ExportOutlined />} href={t ? crUrl(t.tnr) : undefined} target="_blank">
              chess-results
            </Button>
            {admin && (
              <Button icon={<ReloadOutlined />} loading={refetch.isPending} onClick={() => refetch.mutate(undefined)}>
                Stáhnout znovu
              </Button>
            )}
          </Space>
        </Space>
        <Descriptions
          size="small"
          style={{ marginTop: 8 }}
          column={{ xs: 1, sm: 2, lg: 5 }}
          items={[
            { label: 'Datum', children: fmtDate(data?.round.date) },
            { label: 'Kol (partií)', children: t?.roundsCount },
            { label: 'Hráčů', children: t?.playerCount },
            { label: 'Aktualizace na CR', children: t?.crLastUpdate },
            { label: 'Staženo', children: fmtTs(t?.fetchedAt) },
          ]}
        />
      </Card>
      <Table<EntryDto>
        size="small"
        loading={isLoading}
        rowKey="id"
        dataSource={data?.entries}
        pagination={false}
        scroll={{ x: 1200 }}
        rowClassName={(e) => (e.excluded ? 'row-excluded' : e.player?.eligibility !== 'in' ? 'row-out' : '')}
        expandable={{ expandedRowRender: (e) => <GamesList e={e} bySnr={bySnr} />, expandRowByClick: false }}
        components={{ ExpandIcon: ChevronExpand }}
        columns={[
          {
            title: 'Poř.',
            width: 56,
            render: (_, e) =>
              e.rankOverride != null ? (
                <>
                  <span className="strike">{e.rank}</span>
                  <span className="override">{e.rankOverride}</span>
                </>
              ) : (
                e.rank
              ),
          },
          { title: 'St.č.', dataIndex: 'snr', width: 50, className: 'muted' },
          {
            title: 'Na chess-results',
            render: (_, e) => (
              <>
                <div>
                  {e.crName}{' '}
                  {e.mark && (
                    <Tooltip title={`Pořadatel u jména nechal „do ${e.mark}“ (postup do turnaje ${e.mark}) – ze jména odstraněno`}>
                      <Tag color="purple" style={{ fontSize: 11 }}>
                        do {e.mark}
                      </Tag>
                    </Tooltip>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {e.crLokId ? `LOK ${e.crLokId}` : 'bez LOK'} · {e.clubRaw || '—'}
                </div>
              </>
            ),
          },
          { title: 'Rtg', dataIndex: 'rtg', width: 60, align: 'right' },
          {
            title: 'Body',
            width: 80,
            align: 'right',
            render: (_, e) =>
              e.pointsOverride != null ? (
                <Tooltip title={e.note}>
                  <span className="strike">{fmtNum(e.points)}</span>
                  <span className="override">{fmtNum(e.pointsOverride)}</span>
                </Tooltip>
              ) : (
                fmtNum(e.points)
              ),
          },
          { title: 'RŽL body', width: 80, align: 'right', render: (_, e) => <b>{fmtNum(e.rzlPoints)}</b> },
          { title: 'Umíst. v kole', dataIndex: 'placement', width: 90, align: 'right', render: (v) => v ?? <span className="muted">–</span> },
          {
            title: 'Elo',
            width: 100,
            align: 'right',
            render: (_, e) =>
              e.eloAfter != null && (
                <Tooltip title={`Po turnaji ${e.eloAfter}`}>
                  <span className={e.eloDelta! >= 0 ? '' : 'muted'}>
                    {e.eloDelta! >= 0 ? '+' : ''}
                    {Math.round(e.eloDelta!)}
                  </span>{' '}
                  → {e.eloAfter}
                </Tooltip>
              ),
          },
          {
            title: 'Hráč v evidenci aplikace',
            width: 320,
            render: (_, e) => (
              <Space orientation="vertical" size={0}>
                {e.player ? (
                  <>
                    <Space size={4}>
                      <PlayerName name={e.player.name} gender={e.player.gender} genderSource={e.player.genderSource} onClick={() => drawer.open(e.player!.id)} />
                      <RegionTag value={e.player.eligibility} />
                    </Space>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {rzlId(e.player.id)} · {e.player.lokId ? `LOK ${e.player.lokId}` : 'bez LOK'} · {e.player.birthYear ?? 'rok ?'} · {e.player.club ?? '?'}
                    </span>
                  </>
                ) : (
                  <Tag color="red">nepřiřazeno</Tag>
                )}
                {admin && <Space size={4} style={{ fontSize: 12 }}>
                  {e.instance && (
                    <Tooltip title={e.instance.reason}>
                      <Link to={`/s/${seasonId}/parovani`} className="muted num">
                        {instId(e.instance.id)}
                      </Link>
                    </Tooltip>
                  )}
                  {e.instance && <InstanceStatusTag status={e.player || e.match === 'manual' ? e.instance.status : 'open'} />}
                  {e.match === 'manual' && (
                    <Tooltip title="Tento řádek je přiřazen ručně, nezávisle na své instanci">
                      <Tag color="blue">jen tento řádek</Tag>
                    </Tooltip>
                  )}
                </Space>}
              </Space>
            ),
          },
          ...(!admin ? [] : [{
            title: '',
            width: 110,
            fixed: 'right' as const,
            render: (_: unknown, e: EntryDto) => (
              <Space size={0}>
                <Popover
                  trigger="click"
                  title="Přiřadit jinému hráči"
                  content={
                    <Space orientation="vertical" style={{ maxWidth: 340 }}>
                      <PlayerPicker exclude={e.player?.id} onSelect={(pid) => patch.mutate({ id: e.id, body: { playerId: pid, rowOnly } })} />
                      <Space size={6}>
                        <Switch size="small" checked={rowOnly} onChange={setRowOnly} />
                        <span style={{ fontSize: 12 }}>jen tento řádek (výjimka, např. dva hráči se stejným záznamem)</span>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {rowOnly
                          ? 'Změní se jen tento řádek, instance zůstane, kde je.'
                          : `Přiřadí celou instanci${e.instance ? ` ${instId(e.instance.id)}` : ''} – i její řádky v dalších turnajích.`}
                      </Typography.Text>
                      {!rowOnly && (
                        <Button size="small" icon={<UserAddOutlined />} onClick={() => newPlayer.mutate(e.id)}>
                          Je to jiný hráč – založit nového
                        </Button>
                      )}
                    </Space>
                  }
                >
                  <Tooltip title="Přiřadit hráče">
                    <Button size="small" type="text" icon={<UserSwitchOutlined />} />
                  </Tooltip>
                </Popover>
                <Tooltip title="Opravit výsledek">
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditing(e);
                      form.setFieldsValue({ pointsOverride: e.pointsOverride, rankOverride: e.rankOverride, excluded: e.excluded, note: e.note });
                    }}
                  />
                </Tooltip>
              </Space>
            ),
          }]),
        ]}
      />
      <Modal
        title={`Oprava výsledku: ${editing?.crName}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        okText="Uložit"
        onOk={() =>
          form.validateFields().then((v) =>
            patch.mutate(
              { id: editing!.id, body: { pointsOverride: v.pointsOverride ?? null, rankOverride: v.rankOverride ?? null, excluded: !!v.excluded, note: v.note || null } },
              { onSuccess: () => setEditing(null) }
            )
          )
        }
      >
        <Typography.Paragraph type="secondary">
          Na chess-results: {fmtNum(editing?.points)} b., {editing?.rank}. místo. Prázdné pole = platí hodnota z chess-results. Opravy
          přežijí nové stažení turnaje.
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="pointsOverride" label="Body v turnaji">
              <InputNumber min={0} max={20} step={0.5} decimalSeparator="," />
            </Form.Item>
            <Form.Item name="rankOverride" label="Pořadí v turnaji">
              <InputNumber min={1} max={500} />
            </Form.Item>
            <Form.Item name="excluded" label="Nezapočítávat" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="Poznámka (důvod opravy)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
