/** Скачать таблицу для Excel: точка с запятой, BOM для кириллицы. */
export function downloadCsv(name: string, rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
