import { Tooltip } from 'antd';
import { RightOutlined } from '@ant-design/icons';
import type { MouseEventHandler } from 'react';

type Props = { expanded: boolean; expandable: boolean; onClick: MouseEventHandler<HTMLElement>; type: 'row' | 'all' };

/** Table row expander (`components={{ ExpandIcon: ChevronExpand }}`): a chevron that turns down when open – antd's "+" reads as "add". */
export function ChevronExpand({ expanded, expandable, onClick, type }: Props) {
  if (type !== 'row' || !expandable) return null;
  return (
    <Tooltip title={expanded ? 'Skrýt partie' : 'Zobrazit partie'}>
      <RightOutlined
        onClick={onClick}
        style={{ cursor: 'pointer', fontSize: 11, color: '#8a94a0', transition: 'transform .2s', transform: expanded ? 'rotate(90deg)' : undefined }}
      />
    </Tooltip>
  );
}
