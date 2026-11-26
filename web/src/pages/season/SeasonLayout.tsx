import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge, Breadcrumb, Space, Tabs, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useAuth, useSeason } from '../../lib/hooks';
import { PlayerDrawer } from '../../components/PlayerDrawer';

export function useSeasonId(): number {
  return Number(useParams().seasonId);
}

const VIEW_TABS = ['turnaje', 'poradi', 'hraci'];

export function SeasonLayout() {
  const id = useSeasonId();
  const { data } = useSeason(id);
  const nav = useNavigate();
  const loc = useLocation();
  const tab = loc.pathname.split('/')[3] ?? 'turnaje';
  const ic = data?.issueCounts;
  const inc = data?.instanceCounts;

  const auth = useAuth();
  const admin = auth.data?.admin ?? false;
  const allItems = [
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
  // Browsing mode: only the public views.
  const items = admin ? allItems : allItems.filter((i) => VIEW_TABS.includes(i.key));
  if (auth.data && !admin && !VIEW_TABS.includes(tab)) return <Navigate to={`/s/${id}/poradi`} replace />;

  return (
    <>
      <Breadcrumb className="no-print" items={[{ title: <Link to="/">Sezóny</Link> }, { title: `RŽL ${data?.name ?? ''}` }]} />
      <Typography.Title level={3} style={{ margin: '8px 0 0' }}>
        Regionální žákovská liga {data?.name}
      </Typography.Title>
      <Tabs key={admin ? 'full' : 'view'} activeKey={tab} items={items} onChange={(k) => nav(`/s/${id}/${k}${loc.search}`)} />
      {/* Wait for the mode, so an operator-only tab does not load (and fail) before the redirect. */}
      {auth.data && <Outlet />}
      <PlayerDrawer seasonId={id} />
    </>
  );
}
