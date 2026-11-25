import type { ReactNode } from 'react';
import { Space, Tooltip } from 'antd';

/** "D" badge for girls, "?" when the gender is unknown or only guessed from the name. */
export function GenderBadge({ gender, source }: { gender: string | null | undefined; source?: string | null }) {
  if (gender !== 'M' && gender !== 'F')
    return (
      <Tooltip title="Pohlaví neznámé">
        <span className="badge badge-unknown">?</span>
      </Tooltip>
    );
  if (source === 'guess')
    return (
      <Tooltip title={`Pohlaví jen odhadnuto podle jména (${gender === 'F' ? 'dívka' : 'chlapec'}) – potvrďte v detailu hráče nebo v Kontrole`}>
        <span className="badge badge-unknown">{gender === 'F' ? 'D?' : '?'}</span>
      </Tooltip>
    );
  return gender === 'F' ? (
    <Tooltip title="Dívka">
      <span className="badge badge-girl">D</span>
    </Tooltip>
  ) : null;
}

export function PlayerName({
  name,
  gender,
  genderSource,
  onClick,
  style,
  extra,
}: {
  name: string;
  gender: string | null | undefined;
  genderSource?: string | null;
  onClick?: () => void;
  style?: React.CSSProperties;
  extra?: ReactNode;
}) {
  return (
    <Space size={4} style={{ maxWidth: '100%' }}>
      {onClick ? (
        <a onClick={onClick} style={style}>
          {name}
        </a>
      ) : (
        <span style={style}>{name}</span>
      )}
      <GenderBadge gender={gender} source={genderSource} />
      {extra}
    </Space>
  );
}
