import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Descriptions, Divider, Drawer, Form, Input, InputNumber, Modal, Popover, Radio, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CloudSyncOutlined, MergeCellsOutlined, SaveOutlined, UserAddOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { CATEGORIES } from '../../../shared/rzl';
import { api } from '../lib/api';
import { useAction, useClubs, usePlayer, usePlayerDrawer } from '../lib/hooks';
import { fmtDate, fmtNum, fmtTs, INSTANCE_HOW } from '../lib/format';
import { PlayerPicker } from './PlayerPicker';
import { RegionTag } from './RegionTag';
import { PlayerName } from './PlayerName';
import { instId, rzlId } from '../../../shared/text';
import { InstanceStatusTag } from '../pages/season/IdentityTab';

const catLabel = (c: string | null) => CATEGORIES.find((x) => x.id === c)?.label ?? '—';

export function PlayerDrawer({ seasonId }: { seasonId: number }) {
  const { id, close } = usePlayerDrawer();
  const { data, isLoading } = usePlayer(id, seasonId);
  const { data: clubs = [] } = useClubs();
  const [form] = Form.useForm();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState<number | null>(null);
  const p = data?.player;

  useEffect(() => {
    if (p)
      form.setFieldsValue({
        surname: p.surname,
        firstName: p.firstName,
        lokId: p.lokId,
        gender: p.gender,
        birthYear: p.birthYear,
        clubId: p.clubId,
        regionOverride: p.regionOverride ?? 'club',
        note: p.note,
        postup: p.postup ?? '',
      });
  }, [p, form]);

  const save = useAction(async (v: Record<string, unknown>) => {
    const body: Record<string, unknown> = {};
    const cmp: [string, unknown, unknown][] = [
      ['surname', v.surname, p!.surname],
      ['firstName', v.firstName, p!.firstName],
      ['lokId', v.lokId ?? null, p!.lokId],
      ['gender', v.gender ?? null, p!.gender],
      ['birthYear', v.birthYear ?? null, p!.birthYear],
      ['clubId', v.clubId ?? null, p!.clubId],
      ['regionOverride', v.regionOverride === 'club' ? null : v.regionOverride, p!.regionOverride],
      ['note', v.note || null, p!.note],
    ];
    for (const [k, nv, ov] of cmp) if (nv !== ov || (k === 'gender' && nv && p!.genderSource === 'guess')) body[k] = nv;
    if (Object.keys(body).length) await api.patch(`/players/${p!.id}`, body);
    if ((v.postup || null) !== p!.postup) await api.put(`/seasons/${seasonId}/players/${p!.id}`, { postup: v.postup || null });
  }, 'Uloženo');
  const chesscz = useAction(() => api.post(`/players/${p!.id}/chesscz`), 'Načteno z chess.cz');
  const merge = useAction((sourceId: number) => api.post(`/players/${p!.id}/merge`, { sourceId }), 'Hráči sloučeni');
  const assign = useAction((v: { id: number; playerId: number }) => api.post(`/instances/${v.id}/assign`, { playerId: v.playerId }), 'Instance přesunuta');
  const split = useAction((iid: number) => api.post<{ playerId: number }>(`/instances/${iid}/new-player`), 'Založen nový hráč');
  const confirmInst = useAction((iid: number) => api.post('/instances/confirm', { ids: [iid] }), 'Potvrzeno');

  const cz = p?.chesscz;
  const czNameDiffers = cz && cz.fullName.replace(/\s+/g, ' ') !== `${p!.surname} ${p!.firstName}`;

  return (
    <Drawer
      open={id != null}
      onClose={close}
      size={780}
      title={
        p && (
          <Space wrap>
            <PlayerName name={p.name} gender={p.gender} genderSource={p.genderSource} />
            <Tooltip title="Vlastní identifikátor hráče v evidenci RŽL (nemění se, i když hráč získá LOK nebo změní jméno)">
              <Tag color="geekblue">{rzlId(p.id)}</Tag>
            </Tooltip>
            {p.lokId ? <Tag>LOK {p.lokId}</Tag> : <Tag color="orange">bez registrace</Tag>}
            <Tag>{catLabel(p.category)}</Tag>
            <RegionTag value={p.eligibility} />
            {p.rzlElo && <Tag color="blue">RŽL Elo {p.rzlElo}</Tag>}
          </Space>
        )
      }
      loading={isLoading}
      extra={
        <Space>
          {p?.lokId && (
            <Tooltip title="Znovu načíst z chess.cz: rok narození, pohlaví, Elo ČR a FIDE">
              <Button icon={<CloudSyncOutlined />} loading={chesscz.isPending} onClick={() => chesscz.mutate(undefined)}>
                chess.cz
              </Button>
            </Tooltip>
          )}
          <Button icon={<MergeCellsOutlined />} onClick={() => setMergeOpen(true)}>
            Sloučit…
          </Button>
        </Space>
      }
    >
      {p && (
        <>
          {cz && (
            <Descriptions
              size="small"
              bordered
              column={3}
              title={<span style={{ fontSize: 14 }}>chess.cz <span className="muted">({fmtTs(p.chessczAt)})</span></span>}
              items={[
                { label: 'Jméno', children: cz.fullName, span: 2 },
                { label: 'Nar.', children: cz.birthYear },
                { label: 'Oddíl', children: cz.clubName, span: 2 },
                { label: 'Pohlaví', children: cz.gender === 'F' ? 'D' : 'H' },
                { label: 'LOK Elo', children: cz.czeStdElo || '–' },
                { label: 'LOK rapid', children: cz.czeRapidElo || '–' },
                { label: 'Registrace', children: cz.registration ?? '–' },
                {
                  label: 'FIDE ID',
                  children: cz.fideId ? (
                    <a href={`https://ratings.fide.com/profile/${cz.fideId}`} target="_blank" rel="noreferrer">
                      {cz.fideId}
                    </a>
                  ) : (
                    '–'
                  ),
                },
                { label: 'FIDE std / rapid / blesk', children: [cz.fideStdElo, cz.fideRapidElo, cz.fideBlitzElo].map((x) => x || '–').join(' / '), span: 2 },
              ]}
            />
          )}
          {p.lokId && p.chessczAt && !cz && <Alert type="warning" showIcon title={`LOK ${p.lokId} na chess.cz neexistuje`} />}
          {czNameDiffers && (
            <Alert
              style={{ marginTop: 8 }}
              type="warning"
              showIcon
              title={`Na chess.cz je pod LOK ${p.lokId} jméno „${cz!.fullName}“`}
              description="Změna jména → převezměte jméno. Chybné ID v turnaji → smažte LOK ID níže (hráč povede jako neregistrovaný; jeho instance si chybné ID pamatují, takže ho další turnaje dál najdou)."
              action={
                <Button
                  size="small"
                  onClick={() => {
                    const [surname, ...rest] = cz!.fullName.split(' ');
                    form.setFieldsValue({ surname, firstName: rest.join(' ') });
                  }}
                >
                  Převzít jméno
                </Button>
              }
            />
          )}
          <Divider titlePlacement="start" style={{ margin: '16px 0 8px' }}>
            Údaje v evidenci aplikace
          </Divider>
          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Space wrap align="start">
              <Form.Item name="surname" label="Příjmení" rules={[{ required: true }]}>
                <Input style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="firstName" label="Jméno">
                <Input style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="lokId" label="LOK ID" extra={p.lokId ? undefined : 'neregistrovaný'}>
                <InputNumber style={{ width: 110 }} controls={false} />
              </Form.Item>
              <Form.Item name="birthYear" label="Rok narození" extra={p.birthSource && `zdroj: ${p.birthSource}`}>
                <InputNumber style={{ width: 100 }} min={1990} max={2030} controls={false} />
              </Form.Item>
              <Form.Item name="gender" label="Pohlaví" extra={p.genderSource === 'guess' ? 'jen odhad – uložením potvrdíte' : p.genderSource === 'chesscz' ? 'z chess.cz' : undefined}>
                <Radio.Group optionType="button" buttonStyle="solid" options={[{ label: 'H', value: 'M' }, { label: 'D', value: 'F' }]} />
              </Form.Item>
            </Space>
            <Space wrap align="start">
              <Form.Item name="clubId" label="Oddíl / místo" extra={p.clubLocked ? 'nastaveno ručně' : 'podle posledního turnaje'}>
                <Select
                  style={{ width: 220 }}
                  showSearch={{ optionFilterProp: 'label' }}
                  options={clubs.map((c) => ({ value: c.id, label: `${c.name}${c.region === 'out' ? ' (mimo)' : c.region ? '' : ' (?)'}` }))}
                />
              </Form.Item>
              <Form.Item name="regionOverride" label="Příslušnost k regionu">
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { label: 'Podle oddílu', value: 'club' },
                    { label: 'V regionu', value: 'in' },
                    { label: 'Mimo', value: 'out' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="postup" label="Přímý postup (tato sezóna)">
                <Select
                  style={{ width: 160 }}
                  options={[
                    { value: '', label: '—' },
                    { value: '1.10', label: 'ELO k 1.10.' },
                    { value: '1.2', label: 'ELO k 1.2.' },
                  ]}
                />
              </Form.Item>
            </Space>
            <Form.Item name="note" label="Poznámka">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>
              Uložit
            </Button>
          </Form>

          <Divider titlePlacement="start" style={{ margin: '20px 0 8px' }}>
            Instance – jak hráč vystupuje v turnajích
          </Divider>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data!.instances}
            columns={[
              { title: 'ID', width: 64, render: (_, i) => <span className="num muted">{instId(i.id)}</span> },
              {
                title: 'Jméno, LOK, oddíl v turnaji',
                render: (_, i) => (
                  <Tooltip title={`${i.reason ?? ''}${i.how ? ` (${INSTANCE_HOW[i.how] ?? i.how})` : ''}`}>
                    <div>{i.crName}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <span style={i.lokId && i.lokId !== p.lokId ? { color: '#cf1322' } : undefined}>{i.lokId ? `LOK ${i.lokId}` : 'bez LOK'}</span> · {i.club || '—'}
                      {i.birthYear ? ` · nar. ${i.birthYear}` : ''}
                    </div>
                  </Tooltip>
                ),
              },
              {
                title: 'Řádků',
                width: 110,
                render: (_, i) => (
                  <Tooltip title={`${fmtDate(i.firstDate)} – ${fmtDate(i.lastDate)}`}>
                    {i.rows} <span className="muted" style={{ fontSize: 12 }}>{fmtDate(i.lastDate)}</span>
                  </Tooltip>
                ),
              },
              { title: 'Stav', width: 100, render: (_, i) => <InstanceStatusTag status={i.status} /> },
              {
                title: '',
                width: 110,
                render: (_, i) => (
                  <Space size={0}>
                    {i.status !== 'ok' && (
                      <Tooltip title="Potvrdit, že instance patří tomuto hráči">
                        <Button size="small" type="text" icon={<CheckOutlined />} onClick={() => confirmInst.mutate(i.id)} />
                      </Tooltip>
                    )}
                    <Popover
                      trigger="click"
                      title={`Přesunout ${instId(i.id)} jinému hráči`}
                      content={<PlayerPicker exclude={p.id} onSelect={(pid) => assign.mutate({ id: i.id, playerId: pid })} />}
                    >
                      <Tooltip title="Patří jinému hráči">
                        <Button size="small" type="text" icon={<UserSwitchOutlined />} />
                      </Tooltip>
                    </Popover>
                    {data!.instances.length > 1 && (
                      <Tooltip title="Je to jiný hráč – oddělit jako nového">
                        <Button size="small" type="text" icon={<UserAddOutlined />} onClick={() => split.mutate(i.id)} />
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
            ]}
          />

          <Divider titlePlacement="start" style={{ margin: '20px 0 8px' }}>
            Výsledky a RŽL Elo
          </Divider>
          <Table
            size="small"
            rowKey="entryId"
            pagination={false}
            dataSource={data!.results}
            rowClassName={(r) => (r.excluded ? 'row-excluded' : '')}
            columns={[
              { title: 'Datum', render: (_, r) => <span className="num">{fmtDate(r.date)}</span>, width: 90 },
              {
                title: 'Turnaj',
                render: (_, r) => (
                  <Link to={`/s/${r.seasonId}/turnaje/${r.tournamentId}`} onClick={close}>
                    {r.linkName}
                  </Link>
                ),
              },
              {
                title: 'Jako',
                render: (_, r) => (
                  <Tooltip title={`${r.clubRaw}${r.instanceId ? ` · instance ${instId(r.instanceId)}` : ''}${r.match === 'manual' ? ' · řádek přiřazen ručně' : ''}`}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {r.crName} {r.crLokId ? `(${r.crLokId})` : ''}
                    </span>
                  </Tooltip>
                ),
              },
              { title: 'Body', align: 'right', render: (_, r) => fmtNum(r.points) },
              { title: 'Poř.', align: 'right', dataIndex: 'rank' },
              { title: 'Rtg', align: 'right', render: (_, r) => r.rtg ?? '–' },
              {
                title: 'Elo Δ',
                align: 'right',
                render: (_, r) => (r.eloDelta == null ? '' : `${r.eloDelta >= 0 ? '+' : ''}${Math.round(r.eloDelta)}`),
              },
              { title: 'Elo po', align: 'right', dataIndex: 'eloAfter' },
            ]}
          />
        </>
      )}
      <Modal
        open={mergeOpen}
        title={`Sloučit jiného hráče do: ${p?.name}`}
        okText="Sloučit"
        okButtonProps={{ danger: true, disabled: !mergeSource }}
        onCancel={() => setMergeOpen(false)}
        onOk={() => merge.mutate(mergeSource!, { onSuccess: () => setMergeOpen(false) })}
      >
        <Typography.Paragraph>
          Vybraný hráč se smaže a všechny jeho instance (a tím i výsledky) přejdou na <b>{p?.name}</b>. Jednotlivou instanci lze později zase oddělit.
        </Typography.Paragraph>
        <PlayerPicker exclude={p?.id} onSelect={setMergeSource} style={{ width: '100%' }} />
      </Modal>
    </Drawer>
  );
}
