import { App, Input, Radio, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ClubDto } from '../../../../shared/types';
import { api } from '../../lib/api';
import { useAction, useClubs } from '../../lib/hooks';
import { useSeasonId } from './SeasonLayout';

export function ClubsTab() {
  const seasonId = useSeasonId();
  const { data = [], isLoading } = useClubs(seasonId);
  const { modal } = App.useApp();
  const patch = useAction((v: { id: number; body: Partial<ClubDto> }) => api.patch(`/clubs/${v.id}`, v.body), 'Uloženo');
  const merge = useAction((v: { target: number; source: number }) => api.post(`/clubs/${v.target}/merge`, { sourceId: v.source }), 'Oddíly sloučeny');

  return (
    <>
      <Typography.Paragraph type="secondary">
        Příslušnost k regionu se nastavuje u oddílu (u neregistrovaných hráčů je to místo uvedené v turnaji). Hráče lze výjimečně přepnout
        jednotlivě v jeho detailu. Oddíly s <b>?</b> zatím do pořadí nepočítáme. Různé zápisy téhož oddílu (aliasy) slučte.
      </Typography.Paragraph>
      <Table<ClubDto>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data.filter((c) => c.players > 0 || c.region === null)}
        pagination={false}
        columns={[
          {
            title: 'Název (zobrazovaný)',
            width: 220,
            render: (_, c) => (
              <Input
                defaultValue={c.name}
                variant="borderless"
                onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patch.mutate({ id: c.id, body: { name: e.target.value } })}
                onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
              />
            ),
          },
          {
            title: 'Region',
            width: 260,
            render: (_, c) => (
              <Radio.Group
                size="small"
                optionType="button"
                buttonStyle="solid"
                value={c.region ?? 'null'}
                onChange={(e) => patch.mutate({ id: c.id, body: { region: e.target.value === 'null' ? null : (e.target.value as 'in' | 'out') } })}
                options={[
                  { value: 'in', label: 'V regionu' },
                  { value: 'out', label: 'Mimo' },
                  { value: 'null', label: 'nerozhodnuto' },
                ]}
              />
            ),
          },
          { title: 'Hráčů v sezóně', dataIndex: 'players', width: 120, align: 'right' },
          {
            title: 'Zápisy na chess-results',
            render: (_, c) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {c.aliases.join(' · ')}
              </Typography.Text>
            ),
          },
          {
            title: 'Sloučit do',
            width: 200,
            render: (_, c) => (
              <Tooltip title="Tento oddíl je jen jiný zápis vybraného oddílu">
                <Select
                  size="small"
                  style={{ width: 180 }}
                  placeholder="vybrat…"
                  value={null}
                  options={data.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.name }))}
                  showSearch={{ optionFilterProp: 'label' }}
                  onChange={(target: number) =>
                    modal.confirm({
                      title: `Sloučit „${c.name}“ do „${data.find((x) => x.id === target)?.name}“?`,
                      onOk: () => merge.mutateAsync({ target, source: c.id }),
                    })
                  }
                />
              </Tooltip>
            ),
          },
        ]}
      />
      <Space />
    </>
  );
}
