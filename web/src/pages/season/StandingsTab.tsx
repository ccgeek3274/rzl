import { useMemo, useState } from 'react';
import { Button, Input, Popover, Segmented, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { DownloadOutlined, EditOutlined, PrinterOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { CATEGORIES, rankRows, seasonCategories, type Category, type StandingRow } from '../../../../shared/rzl';
import type { RoundDto, StandingDto } from '../../../../shared/types';
import { fold, matchesRzlId, rzlId } from '../../../../shared/text';
import { api } from '../../lib/api';
import { useAction, useIsAdmin, usePlayerDrawer, useSeason, useStandings } from '../../lib/hooks';
import { PlayerName } from '../../components/PlayerName';
import { downloadCsv, fmtDate, fmtNum } from '../../lib/format';
import { useSeasonId } from './SeasonLayout';

const POSTUP_COLOR: Record<string, string> = { '1.10': '#cf1322', '1.2': '#389e0d' };

function RoundHeader({ seasonId, round, editable }: { seasonId: number; round: RoundDto; editable: boolean }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(round.place);
  const save = useAction((place: string) => api.patch(`/seasons/${seasonId}/rounds/${round.id}`, { place }), 'Přejmenováno');
  const submit = () => val.trim() && save.mutate(val.trim(), { onSuccess: () => setOpen(false) });
  return (
    <div style={{ lineHeight: 1.2 }}>
      <div className="round-th">
        <Tooltip title={`${round.ordinal}. kolo · ${round.place} · ${fmtDate(round.date)}`}>
          <span className="round-name">{round.place}</span>
        </Tooltip>
        {editable && <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setVal(round.place);
          }}
          trigger="click"
          title="Název kola (místo)"
          content={
            <Space.Compact>
              <Input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onPressEnter={submit} style={{ width: 200 }} />
              <Button type="primary" loading={save.isPending} onClick={submit}>
                Uložit
              </Button>
            </Space.Compact>
          }
        >
          <EditOutlined className="round-edit" />
        </Popover>}
      </div>
      <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
        {fmtDate(round.date)}
      </div>
    </div>
  );
}

const sub = (title: string) => ({ title, className: 'sub-th' as const });
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function StandingsTab() {
  const id = useSeasonId();
  const { data, isLoading } = useStandings(id);
  const { data: season } = useSeason(id);
  const drawer = usePlayerDrawer();
  const admin = useIsAdmin();
  const [cat, setCat] = useState<'all' | Category>('all');
  const [girls, setGirls] = useState(false);
  const [q, setQ] = useState('');
  const [clubs, setClubs] = useState<string[]>([]);
  const [years, setYears] = useState<number[]>([]);

  const cats = seasonCategories(!!season?.settings.hd8);
  const rounds = data?.rounds ?? [];
  const all = data?.rows ?? [];
  const rows = useMemo(() => {
    let r = all.map((x) => ({ ...x }));
    // Category / girls = separate ranking; club & year filters only narrow the overall list (ranks stay).
    if (cat !== 'all' || girls) {
      r = r.filter((x) => (cat === 'all' || x.category === cat) && (!girls || x.gender === 'F'));
      rankRows(r as unknown as StandingRow[]);
    }
    if (clubs.length) r = r.filter((x) => clubs.includes(x.club ?? ''));
    if (years.length) r = r.filter((x) => years.includes(x.birthYear ?? 0));
    if (q.trim()) r = r.filter((x) => [x.name, ...x.otherNames].some((n) => fold(n).includes(fold(q))) || String(x.lokId ?? '').includes(q.trim()) || matchesRzlId(q, x.playerId));
    return r;
  }, [all, cat, girls, q, clubs, years]);

  const playedRounds = rounds.filter((rd) => all.some((x) => x.results[rd.id]));
  const clubOptions = uniq(all.map((x) => x.club ?? '')).sort((a, b) => a.localeCompare(b, 'cs'));
  const yearOptions = uniq(all.map((x) => x.birthYear ?? 0)).sort((a, b) => b - a);

  const columns: ColumnsType<StandingDto> = [
    { title: 'Poř.', key: 'rank', width: 48, fixed: 'left', align: 'right', render: (_, r) => `${r.rank}.` },
    {
      title: 'Jméno',
      key: 'name',
      fixed: 'left',
      width: 210,
      ellipsis: true,
      render: (_, r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <PlayerName
            name={r.name}
            gender={r.gender}
            genderSource={r.genderSource}
            onClick={() => drawer.open(r.playerId)}
            style={{ color: r.postup ? POSTUP_COLOR[r.postup] : undefined, fontWeight: r.postup ? 600 : undefined }}
          />
          {r.marker && <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 3px', marginInlineEnd: 0, marginLeft: 'auto' }}>{r.marker}</Tag>}
        </div>
      ),
    },
    {
      title: (
        <Tooltip title="Vlastní Elo RŽL (Rtg v posledním turnaji + změna)">
          RŽL
          <br />
          Elo
        </Tooltip>
      ),
      key: 'rzlElo',
      dataIndex: 'rzlElo',
      width: 62,
      align: 'right',
    },
    { title: <Tooltip title="Rapid Elo ČR (chess.cz)">Rapid</Tooltip>, key: 'rapid', dataIndex: 'lokRapidElo', width: 56, align: 'right', render: (v) => v || '' },
    { title: <Tooltip title="Elo ČR – standard (chess.cz)">Elo</Tooltip>, key: 'elo', dataIndex: 'lokElo', width: 56, align: 'right', render: (v) => v || '' },
    {
      title: 'Oddíl',
      key: 'club',
      dataIndex: 'club',
      width: 120,
      ellipsis: true,
      filters: clubOptions.map((c) => ({ text: c || '(bez oddílu)', value: c })),
      filterSearch: true,
      filteredValue: clubs.length ? clubs : null,
    },
    { title: 'Reg.č.', key: 'lok', dataIndex: 'lokId', width: 64, className: 'muted' },
    {
      title: 'Nar.',
      key: 'year',
      width: 62,
      filters: yearOptions.map((y) => ({ text: y || '?', value: y })),
      filteredValue: years.length ? years : null,
      render: (_, r) => (r.birthYear ? String(r.birthYear).slice(2) : <span style={{ color: '#cf1322' }}>?</span>),
    },
    {
      title: 'Kat.',
      key: 'cat',
      width: 62,
      filters: cats.map((c) => ({ text: c.label, value: c.id })),
      filterMultiple: false,
      filteredValue: cat === 'all' ? null : [cat],
      render: (_, r) => (r.category === null ? '?' : r.category),
    },
    { title: 'Poč.', key: 'n', dataIndex: 'nTournaments', width: 44, align: 'right' },
    {
      title: 'Celkem',
      key: 'total',
      children: [
        { ...sub('body'), key: 'tb', width: 52, align: 'right', render: (_, r) => <b>{fmtNum(r.total)}</b> },
        { ...sub('umíst.'), key: 'tp', width: 52, align: 'right', render: (_, r) => <b>{r.placementSum}</b> },
      ],
    },
    ...playedRounds.map((rd) => ({
      title: <RoundHeader seasonId={id} round={rd} editable={admin} />,
      key: `r${rd.id}`,
      children: [
        {
          ...sub('body'),
          key: `r${rd.id}b`,
          width: 46,
          align: 'right' as const,
          render: (_: unknown, r: StandingDto) => {
            const x = r.results[rd.id];
            if (!x) return null;
            return (
              <Tooltip title={`Turnaj ${x.group}: ${fmtNum(x.tourPoints)} b., ${x.rank}. místo${x.counted ? '' : ' · nezapočítáno'}`}>
                <span className={`${x.counted ? 'res-counted' : 'res-dropped'} grp-${x.group}`}>{fmtNum(x.points)}</span>
              </Tooltip>
            );
          },
        },
        {
          ...sub('umíst.'),
          key: `r${rd.id}p`,
          width: 46,
          align: 'right' as const,
          render: (_: unknown, r: StandingDto) => {
            const x = r.results[rd.id];
            return x ? <span className={x.counted ? 'res-counted' : 'res-dropped'}>{x.placement}</span> : null;
          },
        },
      ],
    })),
  ];
  const tableWidth = 48 + 210 + 62 + 56 + 56 + 120 + 64 + 62 + 62 + 44 + 104 + playedRounds.length * 92;

  const exportCsv = () => {
    const head = ['Pořadí', 'Jméno', 'RŽL ID', 'VT', 'RŽL Elo', 'Rapid Elo', 'Elo', 'Oddíl', 'Reg.číslo', 'Nar.', 'Kat.', 'Poč. tur.', 'Celkem body', 'Celkem umístění'];
    for (const rd of playedRounds) head.push(`${rd.place} ${fmtDate(rd.date)} body`, 'umíst.');
    const body = rows.map((r) => {
      const line: (string | number | null)[] = [r.rank, r.name, rzlId(r.playerId), r.marker, r.rzlElo, r.lokRapidElo, r.lokElo, r.club, r.lokId, r.birthYear ? String(r.birthYear).slice(2) : '', r.category, r.nTournaments, fmtNum(r.total), r.placementSum];
      for (const rd of playedRounds) {
        const x = r.results[rd.id];
        line.push(x ? fmtNum(x.points) + (x.counted ? '' : '*') : '', x?.placement ?? '');
      }
      return line;
    });
    const label = cat === 'all' ? 'celkove' : `kat-${cat}`;
    downloadCsv(`RZL_${season?.name.replace('/', '-')}_${label}${girls ? '_divky' : ''}.csv`, [head, ...body]);
  };

  const catTitle = cat === 'all' ? 'Celkové pořadí' : `Kategorie ${CATEGORIES.find((c) => c.id === cat)?.label}`;

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }} className="no-print">
        <Segmented value={cat} onChange={(v) => setCat(v as typeof cat)} options={[{ value: 'all', label: 'Celkově' }, ...cats.map((c) => ({ value: c.id, label: c.label }))]} />
        <Space size={6}>
          <Switch size="small" checked={girls} onChange={setGirls} /> jen dívky
        </Space>
        <Input.Search allowClear placeholder="Hledat jméno / LOK / RŽL ID" style={{ width: 240 }} onChange={(e) => setQ(e.target.value)} />
        {(clubs.length > 0 || years.length > 0) && (
          <Button
            type="link"
            onClick={() => {
              setClubs([]);
              setYears([]);
            }}
          >
            Zrušit filtr oddílu / roku
          </Button>
        )}
        <Button icon={<DownloadOutlined />} onClick={exportCsv}>
          CSV
        </Button>
        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
          Tisk
        </Button>
      </Space>
      <Typography.Title level={5} style={{ margin: '0 0 4px' }}>
        {catTitle}
        {girls ? ' – dívky' : ''} · {playedRounds.length < rounds.length ? 'průběžné' : 'konečné'} pořadí, započítáno {data?.bestN} nejlepších výsledků z{' '}
        {rounds.length} turnajů
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        Tučně započítané výsledky, šedě nezapočítané. <span className="badge badge-girl">D</span> dívka, <span className="badge badge-unknown">?</span> pohlaví
        neověřeno. Barva bodů = turnaj <span className="grp-A">A</span> / <span className="grp-B">B</span> /{' '}
        <span className="grp-C">C</span>. Jméno <span style={{ color: POSTUP_COLOR['1.10'] }}>červeně</span> = přímý postup ELO k 1.10.,{' '}
        <span style={{ color: POSTUP_COLOR['1.2'] }}>zeleně</span> = k 1.2. {season && season.issueCounts.error > 0 && <Tag color="red">Kontrola hlásí {season.issueCounts.error} chyb</Tag>}
      </Typography.Paragraph>
      <Table<StandingDto>
        className="standings-table"
        size="small"
        bordered
        loading={isLoading}
        rowKey="playerId"
        dataSource={rows}
        columns={columns}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: tableWidth }}
        sticky
        onChange={(_, f) => {
          setClubs((f.club as string[] | null) ?? []);
          setYears((f.year as number[] | null) ?? []);
          setCat(((f.cat as Category[] | null) ?? [])[0] ?? 'all');
        }}
      />
    </>
  );
}
