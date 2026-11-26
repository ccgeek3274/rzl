import { Link } from 'react-router-dom';
import { Button, Card, Dropdown, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CloudDownloadOutlined, ExportOutlined, ReloadOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import type { RoundDto, TournamentDto } from '../../../../shared/types';
import { api } from '../../lib/api';
import { crUrl, useAction, useIsAdmin, useSeason } from '../../lib/hooks';
import { fmtDate, fmtTs } from '../../lib/format';
import { eloRefreshStep } from '../../lib/eloRefresh';
import { useBatch } from '../../components/BatchRunner';
import { useSeasonId } from './SeasonLayout';

const GROUPS = ['A', 'B', 'C'];

function TournamentCell({ t, seasonId, onFetch }: { t?: TournamentDto; seasonId: number; onFetch?: (t: TournamentDto) => void }) {
  if (!t) return <span className="muted">—</span>;
  const status =
    t.status === 'fetched' ? (
      <Tag color="green">{t.playerCount} hráčů</Tag>
    ) : t.status === 'error' ? (
      <Tooltip title={t.error}>
        <Tag color="red">chyba</Tag>
      </Tooltip>
    ) : (
      <Tag>nenačteno</Tag>
    );
  return (
    <Space orientation="vertical" size={2}>
      <Space size={4}>
        {t.status === 'fetched' ? <Link to={`/s/${seasonId}/turnaje/${t.id}`}>{t.linkName}</Link> : <span>{t.linkName}</span>}
        {status}
      </Space>
      <Space size={2}>
        {onFetch && (
          <Tooltip title={t.status === 'fetched' ? 'Stáhnout znovu z chess-results' : 'Stáhnout z chess-results'}>
            <Button size="small" type="text" icon={t.status === 'fetched' ? <ReloadOutlined /> : <CloudDownloadOutlined />} onClick={() => onFetch(t)} />
          </Tooltip>
        )}
        <Tooltip title="Otevřít na chess-results">
          <Button size="small" type="text" icon={<ExportOutlined />} href={crUrl(t.tnr)} target="_blank" />
        </Tooltip>
        <span className="muted" style={{ fontSize: 11 }}>
          {t.crLastUpdate ? `CR ${t.crLastUpdate.slice(0, 16)}` : `tnr ${t.tnr}`}
        </span>
      </Space>
    </Space>
  );
}

export function TournamentsTab() {
  const id = useSeasonId();
  const { data, isLoading } = useSeason(id);
  const batch = useBatch();
  const admin = useIsAdmin();
  const discover = useAction(() => api.post<{ total: number; added: number }>(`/seasons/${id}/discover`), (r) => `Nalezeno ${r.total} turnajů, nových ${r.added}`);
  const fetchOne = useAction(
    (t: TournamentDto) => api.post<{ players: number; created: number }>(`/tournaments/${t.id}/fetch${t.hasRaw && t.status !== 'fetched' ? '?stored=1' : ''}`),
    (r) => `Načteno ${r.players} hráčů (${r.created} nových v evidenci aplikace)`
  );

  const ts = data?.tournaments ?? [];
  const fetchMany = (list: TournamentDto[], title: string) =>
    batch.run(
      title,
      list.map((t) => ({ label: t.linkName, run: () => api.post(`/tournaments/${t.id}/fetch${t.hasRaw && t.status !== 'fetched' ? '?stored=1' : ''}`) }))
    );
  const enrich = () => batch.loop('Doplňuji údaje hráčů (chess.cz / chess-results)', () => api.post(`/seasons/${id}/enrich`, { limit: 10 }));
  // One round at a time: its tournaments (from the stored copy when the round was downloaded before), then player data.
  const importRound = async (list: TournamentDto[]) => {
    await batch.run(
      'Načítám kolo',
      list.map((t) => ({ label: t.linkName, run: () => api.post(`/tournaments/${t.id}/fetch${t.hasRaw && t.status !== 'fetched' ? '?stored=1' : ''}`) }))
    );
    await enrich();
  };

  const rows = (data?.rounds ?? []).map((r) => ({ round: r, byGroup: Object.fromEntries(ts.filter((t) => t.roundId === r.id).map((t) => [t.grp, t])) }));
  const pending = ts.filter((t) => t.status !== 'fetched');

  return (
    <>
      {batch.view}
      {admin && (
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button icon={<SearchOutlined />} loading={discover.isPending} onClick={() => discover.mutate(undefined)}>
            Zjistit nové turnaje
          </Button>
          <Button icon={<CloudDownloadOutlined />} disabled={batch.running || !pending.length} onClick={() => fetchMany(pending, 'Načítám nenačtené turnaje')}>
            Načíst nenačtené ({pending.length})
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: 'all', label: `Stáhnout znovu všech ${ts.length} turnajů`, onClick: () => fetchMany(ts, 'Aktualizuji všechny turnaje') },
                { key: 'elo', label: 'Aktualizovat Ela hráčů (chess.cz)', onClick: () => batch.loop('Aktualizuji Ela z chess.cz', eloRefreshStep(id)) },
              ],
            }}
          >
            <Button icon={<ReloadOutlined />} disabled={batch.running}>
              Aktualizovat…
            </Button>
          </Dropdown>
          <Tooltip title="Registrovaní: rok narození, pohlaví, jméno, Elo ČR a FIDE z chess.cz. Neregistrovaní: rok narození z karty hráče na chess-results.">
            <Button icon={<TeamOutlined />} disabled={batch.running} onClick={enrich}>
              Doplnit údaje hráčů
            </Button>
          </Tooltip>
          <Typography.Text type="secondary">
            Seed{' '}
            <a href={crUrl(data?.seedTnr ?? 0, 0)} target="_blank" rel="noreferrer">
              {data?.seedTnr}
            </a>
          </Typography.Text>
        </Space>
      </Card>
      )}
      <Table
        size="small"
        loading={isLoading}
        rowKey={(r) => r.round.id}
        pagination={false}
        dataSource={rows}
        columns={[
          { title: 'Kolo', width: 60, render: (_, r) => <b>{r.round.ordinal}.</b> },
          ...(!admin ? [] : [{
            title: '',
            width: 130,
            render: (_: unknown, r: { byGroup: Record<string, TournamentDto> }) => {
              const list = GROUPS.map((g) => r.byGroup[g]).filter(Boolean);
              const todo = list.filter((t) => t.status !== 'fetched');
              if (!todo.length) return null;
              const stored = todo.every((t) => t.hasRaw);
              return (
                <Tooltip title={`Načte turnaje kola${stored ? ' z uložené kopie (bez stahování)' : ' z chess-results'} a doplní údaje nových hráčů. Pak zkontrolujte Párování.`}>
                  <Button size="small" type="primary" ghost icon={<CloudDownloadOutlined />} disabled={batch.running} onClick={() => importRound(todo)}>
                    Načíst kolo
                  </Button>
                </Tooltip>
              );
            },
          }]),
          {
            title: 'Místo a datum',
            width: 200,
            render: (_, r: { round: RoundDto }) => (
              <>
                <div>{r.round.place}</div>
                <div className="muted">{fmtDate(r.round.date)}</div>
              </>
            ),
          },
          ...GROUPS.map((g) => ({
            title: <span className={`grp-${g}`}>Turnaj {g}</span>,
            render: (_: unknown, r: { byGroup: Record<string, TournamentDto> }) => (
              <TournamentCell t={r.byGroup[g]} seasonId={id} onFetch={admin ? (t) => fetchOne.mutate(t) : undefined} />
            ),
          })),
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
        Turnaje se zjišťují z detailu seed turnaje („Výběr turnaje“). Data jsou uložená lokálně; „Stáhnout znovu“ zachová ruční opravy a
        přiřazení hráčů. Naposledy zjištěno {fmtTs(data?.discoveredAt)}.
      </Typography.Paragraph>
    </>
  );
}
