export { fmtNum } from '../../../shared/text';

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day}.${m}.${y}`;
}

export function fmtTs(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const REGION_LABEL: Record<string, string> = { in: 'V regionu', out: 'Mimo region' };
export const INSTANCE_STATUS: Record<string, { label: string; color: string; hint: string }> = {
  open: { label: 'k rozhodnutí', color: 'red', hint: 'Není jasné, komu instance patří – vyberte hráče nebo založte nového' },
  auto: { label: 'ke kontrole', color: 'orange', hint: 'Přiřazeno automaticky – po ověření potvrďte' },
  ok: { label: 'potvrzeno', color: 'green', hint: 'Přiřazení ověřeno' },
};
export const INSTANCE_HOW: Record<string, string> = {
  new: 'nový hráč',
  lok: 'podle LOK',
  'lok-instance': 'podle LOK z jiného turnaje',
  manual: 'ručně',
  legacy: 'převedeno z dřívějška',
};

/** CSV for Excel (semicolon, BOM). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
