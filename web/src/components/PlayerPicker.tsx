import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { api } from '../lib/api';

type Hit = { id: number; name: string; otherNames: string[]; lokId: number | null; birthYear: number | null; club: string | null };

/** Search players by name or LOK ID. */
export function PlayerPicker({ onSelect, exclude, placeholder, style }: { onSelect: (id: number) => void; exclude?: number; placeholder?: string; style?: React.CSSProperties }) {
  const [q, setQ] = useState('');
  const { data = [], isFetching } = useQuery({
    queryKey: ['player-search', q],
    queryFn: () => api.get<Hit[]>(`/players/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });
  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setQ }}
      placeholder={placeholder ?? 'Hledat hráče (jméno nebo LOK)…'}
      loading={isFetching}
      style={{ minWidth: 280, ...style }}
      notFoundContent={q.length < 2 ? 'Napište aspoň 2 znaky' : 'Nic nenalezeno'}
      options={data
        .filter((h) => h.id !== exclude)
        .map((h) => ({
          value: h.id,
          label: `${h.name}${h.otherNames.length ? ` (v turnajích i ${h.otherNames.join(', ')})` : ''}${h.lokId ? ` · LOK ${h.lokId}` : ' · bez LOK'}${h.birthYear ? ` · ${h.birthYear}` : ''}${h.club ? ` · ${h.club}` : ''}`,
        }))}
      onChange={(v) => onSelect(v as number)}
    />
  );
}
