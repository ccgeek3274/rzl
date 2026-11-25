import { Tag, Tooltip } from 'antd';

export function RegionTag({ value }: { value: 'in' | 'out' | null | undefined }) {
  if (value === 'in') return null;
  if (value === 'out') return <Tag color="default">mimo region</Tag>;
  return (
    <Tooltip title="Nerozhodnuto, zda hráč patří do regionu (nastavte u oddílu nebo hráče). Do pořadí se zatím nepočítá.">
      <Tag color="red">region ?</Tag>
    </Tooltip>
  );
}
