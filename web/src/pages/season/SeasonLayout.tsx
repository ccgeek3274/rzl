import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge, Breadcrumb, Space, Tabs, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useSeason } from '../../lib/hooks';
import { PlayerDrawer } from '../../components/PlayerDrawer';

export function useSeasonId(): number {
  return Number(useParams().seasonId);
}

export function SeasonLayout() {
  const id = useSeasonId();
  const { data } = useSeason(id);
  const nav = useNavigate();
  const loc = useLocation();
  const tab = loc.pathname.split('/')[3] ?? 'turnaje';
  const ic = data?.issueCounts;
  const inc = data?.instanceCounts;

  const items = [
    { key: 'turnaje', label: 'Turnaje' },
    {
      key: 'parovani',
      label: (
        <Space size={6}>
          Párování
          {inc && inc.open > 0 && <Badge count={inc.open} color="#cf1322" overflowCount={999} title="K rozhodnutí" />}
          {inc && inc.auto > 0 && <Badge count={inc.auto} color="#d48806" overflowCount={999} title="Ke kontrole" />}
        </Space>
      ),
    },
    {
      key: 'kontrola',
      label: (
        <Space size={6}>
          Kontrola
          {ic && ic.error > 0 && <Badge count={ic.error} color="#cf1322" overflowCount={999} />}
          {ic && ic.warning > 0 && <Badge count={ic.warning} color="#d48806" overflowCount={999} />}
        </Space>
      ),
    },
    { key: 'poradi', label: 'Pořadí' },
    { key: 'hraci', label: 'Hráči' },
    { key: 'oddily', label: 'Oddíly a region' },
    { key: 'nastaveni', label: 'Nastavení' },
  ];

  return (
    <>
      <Breadcrumb className="no-print" items={[{ title: <Link to="/">Sezóny</Link> }, { title: `RŽL ${data?.name ?? ''}` }]} />
      <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
        Regionální žákovská liga {data?.name}
      </Typography.Title>
      <Tabs activeKey={tab} items={items} onChange={(k) => nav(`/s/${id}/${k}${loc.search}`)} />
      <Outlet />
      <PlayerDrawer seasonId={id} />
    </>
  );
}
