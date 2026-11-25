import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Card, Empty, Segmented, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled, UndoOutlined } from '@ant-design/icons';
import type { Issue } from '../../../../shared/types';
import { api } from '../../lib/api';
import { rzlId } from '../../../../shared/text';
import { useAction, useIssues, usePlayerDrawer } from '../../lib/hooks';
import { useBatch } from '../../components/BatchRunner';
import { useSeasonId } from './SeasonLayout';

const SEV_ICON = {
  error: <CloseCircleFilled style={{ color: '#cf1322' }} />,
  warning: <ExclamationCircleFilled style={{ color: '#d48806' }} />,
  info: <InfoCircleFilled style={{ color: '#1f5f8b' }} />,
};

const TYPE_LABEL: Record<string, string> = {
  club: 'Region',
  gender: 'Pohlaví',
  duplicate: 'Duplicity',
  match: 'Párování',
  player: 'Hráči',
  tournament: 'Turnaje',
  round: 'Kola',
  entry: 'Řádky',
  override: 'Opravy',
};

export function IssuesTab() {
  const id = useSeasonId();
  const { data = [], isLoading } = useIssues(id);
  const drawer = usePlayerDrawer();
  const { modal } = App.useApp();
  const [type, setType] = useState<string>('all');
  const [showAcked, setShowAcked] = useState(false);
  const batch = useBatch();

  const ack = useAction((v: { key: string; acked: boolean }) => api.post(`/seasons/${id}/issues/ack`, v));
  const setRegion = useAction((v: { clubId: number; region: 'in' | 'out' }) => api.patch(`/clubs/${v.clubId}`, { region: v.region }), 'Uloženo');
  const setGender = useAction((v: { playerId: number; gender: 'M' | 'F' }) => api.patch(`/players/${v.playerId}`, { gender: v.gender }), 'Uloženo');
  const exclude = useAction((v: { entryId: number }) => api.patch(`/entries/${v.entryId}`, { excluded: true, note: 'nenastoupil' }), 'Vyřazeno');
  const merge = useAction((v: { target: number; source: number }) => api.post(`/players/${v.target}/merge`, { sourceId: v.source }), 'Sloučeno');

  const guesses = data.filter((i) => i.key.startsWith('gender-guess:'));
  const visible = data.filter((i) => !i.key.startsWith('gender-guess:') && (showAcked || !i.acked) && (type === 'all' || i.type === type));
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of data) if (!i.acked && !i.key.startsWith('gender-guess:')) c[i.type] = (c[i.type] ?? 0) + 1;
    return c;
  }, [data]);

  const actions = (i: Issue) => (
    <Space wrap size={4}>
      {i.type === 'club' && i.refs.clubId && (
        <>
          <Button size="small" onClick={() => setRegion.mutate({ clubId: i.refs.clubId!, region: 'in' })}>
            Patří do regionu
          </Button>
          <Button size="small" onClick={() => setRegion.mutate({ clubId: i.refs.clubId!, region: 'out' })}>
            Mimo region
          </Button>
        </>
      )}
      {i.type === 'gender' && i.refs.playerId && (
        <>
          <Button size="small" onClick={() => setGender.mutate({ playerId: i.refs.playerId!, gender: 'F' })}>
            Dívka
          </Button>
          <Button size="small" onClick={() => setGender.mutate({ playerId: i.refs.playerId!, gender: 'M' })}>
            Chlapec
          </Button>
        </>
      )}
      {i.key.startsWith('no-show:') && i.refs.entryId && (
        <Button size="small" onClick={() => exclude.mutate({ entryId: i.refs.entryId! })}>
          Vyřadit
        </Button>
      )}
      {i.refs.playerId && (
        <Button size="small" type="link" onClick={() => drawer.open(i.refs.playerId!)}>
          Hráč
        </Button>
      )}
      {i.refs.playerIds?.map((pid) => (
        <Button key={pid} size="small" type="link" onClick={() => drawer.open(pid)}>
          {rzlId(pid)}
        </Button>
      ))}
      {i.type === 'duplicate' && i.refs.playerIds?.length === 2 && (
        <Tooltip title={`Výsledky ${rzlId(i.refs.playerIds[1])} přejdou na ${rzlId(i.refs.playerIds[0])} (LOK se převezme)`}>
          <Button
            size="small"
            onClick={() =>
              modal.confirm({
                title: 'Sloučit hráče?',
                content: i.detail,
                okText: 'Sloučit',
                onOk: () => merge.mutateAsync({ target: i.refs.playerIds![0], source: i.refs.playerIds![1] }),
              })
            }
          >
            Sloučit
          </Button>
        </Tooltip>
      )}
      {(i.key === 'inst-open' || i.refs.instanceId) && (
        <Link to={`/s/${id}/parovani`}>
          <Button size="small">Párování</Button>
        </Link>
      )}
      {i.refs.tournamentId && (
        <Link to={`/s/${id}/turnaje/${i.refs.tournamentId}`}>
          <Button size="small" type="link">
            Turnaj
          </Button>
        </Link>
      )}
      {i.severity === 'error' || i.type === 'gender' || i.key === 'inst-open' ? null : i.acked ? (
        <Button size="small" icon={<UndoOutlined />} onClick={() => ack.mutate({ key: i.key, acked: false })}>
          Vrátit
        </Button>
      ) : (
        <Tooltip title="Prověřil(a) jsem, je to v pořádku – na datech se nic nemění, upozornění se jen skryje (vrátit jde přes „zobrazit i ty označené V pořádku“)">
          <Button size="small" icon={<CheckOutlined />} onClick={() => ack.mutate({ key: i.key, acked: true })}>
            V pořádku
          </Button>
        </Tooltip>
      )}
    </Space>
  );

  return (
    <>
      {batch.view}
      <Typography.Paragraph type="secondary" style={{ maxWidth: 900 }}>
        Co je v datech sezóny potřeba vyřešit nebo prověřit. {SEV_ICON.error} <b>Chyba</b> – výsledky se nepočítají správně, je
        potřeba ji vyřešit (zmizí sama). {SEV_ICON.warning} <b>Upozornění</b> – může být v pořádku; po prověření klikněte „V
        pořádku“ a skryje se. {SEV_ICON.info} <b>Informace</b>.
      </Typography.Paragraph>
      {guesses.length > 0 && <GenderGuesses seasonId={id} issues={guesses} onOpen={drawer.open} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={type}
          onChange={(v) => setType(v as string)}
          options={[
            { value: 'all', label: `Vše (${Object.values(counts).reduce((a, b) => a + b, 0)})` },
            ...Object.keys(TYPE_LABEL)
              .filter((k) => counts[k])
              .map((k) => ({ value: k, label: `${TYPE_LABEL[k]} (${counts[k]})` })),
          ]}
        />
        <Space size={6}>
          <Switch size="small" checked={showAcked} onChange={setShowAcked} /> zobrazit i ty označené „V pořádku“
        </Space>
      </Space>
      {!isLoading && !visible.length ? (
        <Empty description="Žádné další nevyřešené problémy" />
      ) : (
        <Table<Issue>
          size="small"
          rowKey="key"
          loading={isLoading}
          dataSource={visible}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          rowClassName={(i) => (i.acked ? 'issue-acked' : '')}
          columns={[
            { title: '', width: 30, render: (_, i) => SEV_ICON[i.severity] },
            { title: 'Typ', width: 100, render: (_, i) => <Tag>{TYPE_LABEL[i.type]}</Tag> },
            {
              title: 'Problém',
              render: (_, i) => (
                <>
                  <div>{i.title}</div>
                  {i.detail && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {i.detail}
                    </Typography.Text>
                  )}
                </>
              ),
            },
            { title: 'Akce', width: 360, render: (_, i) => actions(i) },
          ]}
        />
      )}
    </>
  );
}

/** Genders guessed from names: listed as girls / boys, a name can be flipped, then all confirmed at once. */
function GenderGuesses({ seasonId, issues, onOpen }: { seasonId: number; issues: Issue[]; onOpen: (id: number) => void }) {
  const [flip, setFlip] = useState<Set<number>>(new Set());
  const save = useAction(
    () =>
      api.post(`/seasons/${seasonId}/genders`, {
        items: issues.map((i) => {
          const g = i.refs.gender === 'F' ? 'F' : 'M';
          return { playerId: i.refs.playerId!, gender: flip.has(i.refs.playerId!) ? (g === 'F' ? 'M' : 'F') : g };
        }),
      }),
    'Pohlaví potvrzeno'
  );
  const name = (i: Issue) => i.title.replace(/: pohlaví jen odhadnuto.*$/, '');
  const genderOf = (i: Issue) => {
    const g = i.refs.gender === 'F' ? 'F' : 'M';
    return flip.has(i.refs.playerId!) ? (g === 'F' ? 'M' : 'F') : g;
  };
  const toggle = (pid: number) => setFlip((s) => (s.has(pid) ? new Set([...s].filter((x) => x !== pid)) : new Set([...s, pid])));
  const col = (g: 'F' | 'M') => {
    const list = issues.filter((i) => genderOf(i) === g).sort((a, b) => name(a).localeCompare(name(b), 'cs'));
    return (
      <div style={{ flex: 1, minWidth: 260 }}>
        <Typography.Text strong>
          {g === 'F' ? 'Dívky' : 'Chlapci'} ({list.length})
        </Typography.Text>
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.map((i) => (
            <Tag key={i.key} color={flip.has(i.refs.playerId!) ? 'orange' : undefined} style={{ marginInlineEnd: 0 }}>
              <a onClick={() => onOpen(i.refs.playerId!)}>{name(i)}</a>
              <Tooltip title={g === 'F' ? 'Je to chlapec' : 'Je to dívka'}>
                <Button size="small" type="link" style={{ padding: '0 0 0 6px', height: 18 }} onClick={() => toggle(i.refs.playerId!)}>
                  {g === 'F' ? '→ H' : '→ D'}
                </Button>
              </Tooltip>
            </Tag>
          ))}
        </div>
      </div>
    );
  };
  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <Space>
          {SEV_ICON.warning}
          <span>Pohlaví odhadnuté podle jména ({issues.length} hráčů)</span>
        </Space>
      }
      extra={
        <Button type="primary" icon={<CheckOutlined />} loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Potvrdit všechny{flip.size ? ` (${flip.size} opraveno)` : ''}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Pohlaví se určuje kvůli pořadí dívek. Zkontrolujte rozdělení, případně u jména klikněte → H / → D, a pak potvrďte vše najednou.
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {col('F')}
        {col('M')}
      </div>
    </Card>
  );
}
