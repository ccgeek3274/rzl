import { OtherNames } from '../../components/OtherNames';
import { useMemo, useState } from 'react';
import { Badge, Button, Input, Segmented, Space, Table, Tag, Tooltip } from 'antd';
import { LineChartOutlined, TeamOutlined } from '@ant-design/icons';
import type { SeasonPlayerDto } from '../../../../shared/types';
import { CATEGORIES } from '../../../../shared/rzl';
import { fold, matchesRzlId, rzlId } from '../../../../shared/text';
import { PlayerName } from '../../components/PlayerName';
import { api } from '../../lib/api';
import { usePlayerDrawer, useSeasonPlayers } from '../../lib/hooks';
import { useBatch } from '../../components/BatchRunner';
import { eloRefreshStep } from '../../lib/eloRefresh';
import { RegionTag } from '../../components/RegionTag';
import { useSeasonId } from './SeasonLayout';

type Filter = 'all' | 'issues' | 'in' | 'undecided' | 'out' | 'nobirth' | 'unreg';

export function PlayersTab() {
  const id = useSeasonId();
  const { data = [], isLoading } = useSeasonPlayers(id);
  const drawer = usePlayerDrawer();
  const batch = useBatch();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(
    () =>
      data.filter((p) => {
        if (q.trim() && ![p.name, ...p.otherNames].some((n) => fold(n).includes(fold(q))) && !String(p.lokId ?? '').includes(q.trim()) && !matchesRzlId(q, p.id)) return false;
        switch (filter) {
          case 'issues':
            return p.issues > 0;
          case 'in':
            return p.eligibility === 'in';
          case 'out':
            return p.eligibility === 'out';
          case 'undecided':
            return p.eligibility === null;
          case 'nobirth':
            return !p.birthYear;
          case 'unreg':
            return !p.lokId;
          default:
            return true;
        }
      }),
    [data, filter, q]
  );
  const clubOptions = useMemo(() => [...new Set(data.map((p) => p.club ?? ''))].sort((a, b) => a.localeCompare(b, 'cs')), [data]);
  const n = (f: Filter) => data.filter((p) => (f === 'issues' ? p.issues > 0 : f === 'in' ? p.eligibility === 'in' : f === 'out' ? p.eligibility === 'out' : f === 'undecided' ? p.eligibility === null : f === 'nobirth' ? !p.birthYear : f === 'unreg' ? !p.lokId : true)).length;

  return (
    <>
      {batch.view}
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'all', label: `Všichni (${data.length})` },
            { value: 'issues', label: `S problémem (${n('issues')})` },
            { value: 'in', label: `V regionu (${n('in')})` },
            { value: 'undecided', label: `Region ? (${n('undecided')})` },
            { value: 'out', label: `Mimo (${n('out')})` },
            { value: 'nobirth', label: `Bez roku nar. (${n('nobirth')})` },
            { value: 'unreg', label: `Bez registrace (${n('unreg')})` },
          ]}
        />
        <Input.Search allowClear placeholder="Hledat jméno / LOK / RŽL ID" style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
        <Button icon={<TeamOutlined />} disabled={batch.running} onClick={() => batch.loop('Doplňuji údaje hráčů', () => api.post(`/seasons/${id}/enrich`, { limit: 10 }))}>
          Doplnit údaje hráčů
        </Button>
        <Tooltip title="Aktuální Elo ČR (standard, rapid) a FIDE (standard, rapid, blesk) a registrace všech registrovaných hráčů sezóny z chess.cz – po oddílech (jeden dotaz na oddíl), hráči mimo svůj oddíl po jednom.">
          <Button icon={<LineChartOutlined />} disabled={batch.running} onClick={() => batch.loop('Aktualizuji Ela z chess.cz', eloRefreshStep(id))}>
            Aktualizovat Ela
          </Button>
        </Tooltip>
      </Space>
      <Table<SeasonPlayerDto>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 100, hideOnSinglePage: true }}
        onRow={(p) => ({ onClick: () => drawer.open(p.id), style: { cursor: 'pointer' } })}
        rowClassName={(p) => (p.eligibility === 'out' ? 'row-out' : '')}
        columns={[
          {
            title: 'Jméno',
            sorter: (a, b) => a.name.localeCompare(b.name, 'cs'),
            render: (_, p) => (
              <>
                <PlayerName name={p.name} gender={p.gender} genderSource={p.genderSource} extra={p.issues > 0 && <Badge count={p.issues} size="small" color="#d48806" />} />
                <OtherNames names={p.otherNames} />
              </>
            ),
          },
          { title: 'RŽL ID', key: 'rid', width: 76, className: 'muted num', sorter: (a, b) => a.id - b.id, render: (_, p) => rzlId(p.id) },
          { title: 'LOK', dataIndex: 'lokId', width: 80, render: (v) => v ?? <Tag color="orange">bez reg.</Tag> },
          {
            title: 'Nar.',
            width: 80,
            sorter: (a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0),
            render: (_, p) =>
              p.birthYear ? (
                <Tooltip title={`zdroj: ${p.birthSource}`}>{p.birthYear}</Tooltip>
              ) : (
                <span style={{ color: '#cf1322' }}>?</span>
              ),
          },
          {
            title: 'Kat.',
            key: 'cat',
            width: 90,
            filters: [...CATEGORIES.filter((c) => data.some((p) => p.category === c.id)).map((c) => ({ text: c.label, value: c.id })), { text: '?', value: '' }],
            onFilter: (v, p) => (p.category ?? '') === v,
            render: (_, p) => CATEGORIES.find((c) => c.id === p.category)?.label ?? '?',
          },
          {
            title: 'H/D',
            key: 'gender',
            width: 70,
            filters: [
              { text: 'H', value: 'M' },
              { text: 'D', value: 'F' },
              { text: '? (neurčeno / odhad)', value: '?' },
            ],
            onFilter: (v, p) => (v === '?' ? p.gender !== 'M' && p.gender !== 'F' || p.genderSource === 'guess' : p.gender === v),
            render: (_, p) => (
              <Tooltip title={p.genderSource === 'guess' ? 'odhad z příjmení' : p.genderSource}>
                <span style={{ fontStyle: p.genderSource === 'guess' ? 'italic' : undefined }}>{p.gender === 'F' ? 'D' : p.gender === 'M' ? 'H' : '?'}</span>
              </Tooltip>
            ),
          },
          {
            title: 'Oddíl',
            dataIndex: 'club',
            key: 'club',
            width: 170,
            sorter: (a, b) => (a.club ?? '').localeCompare(b.club ?? '', 'cs'),
            filters: clubOptions.map((c) => ({ text: c || '(bez oddílu)', value: c })),
            filterSearch: true,
            onFilter: (v, p) => (p.club ?? '') === v,
          },
          { title: 'Region', width: 110, render: (_, p) => (p.eligibility === 'in' ? <span className="muted">ano</span> : <RegionTag value={p.eligibility} />) },
          { title: 'Turnajů', dataIndex: 'tournaments', width: 80, align: 'right', sorter: (a, b) => a.tournaments - b.tournaments },
          {
            title: (
              <>
                RŽL
                <br />
                Elo
              </>
            ),
            dataIndex: 'rzlElo',
            width: 64,
            align: 'right',
            sorter: (a, b) => (a.rzlElo ?? 0) - (b.rzlElo ?? 0),
          },
          { title: <Tooltip title="Elo ČR standard (chess.cz)">LOK Elo</Tooltip>, width: 80, align: 'right', sorter: (a, b) => (a.chesscz?.czeStdElo ?? 0) - (b.chesscz?.czeStdElo ?? 0), render: (_, p) => p.chesscz?.czeStdElo || '' },
          { title: <Tooltip title="Elo ČR rapid (chess.cz)">LOK rapid</Tooltip>, width: 80, align: 'right', sorter: (a, b) => (a.chesscz?.czeRapidElo ?? 0) - (b.chesscz?.czeRapidElo ?? 0), render: (_, p) => p.chesscz?.czeRapidElo || '' },
          {
            title: <Tooltip title="FIDE standard / rapid / blesk (z chess.cz)">FIDE</Tooltip>,
            width: 120,
            align: 'right',
            render: (_, p) => {
              const c = p.chesscz;
              const v = [c?.fideStdElo, c?.fideRapidElo, c?.fideBlitzElo];
              return v.some(Boolean) ? <span className="num">{v.map((x) => x || '–').join(' / ')}</span> : '';
            },
          },
          { title: 'Pozn.', dataIndex: 'note', ellipsis: true },
        ]}
      />
    </>
  );
}
