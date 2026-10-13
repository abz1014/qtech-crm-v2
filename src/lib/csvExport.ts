// Ported from src/lib/csvExport.ts @ 7a29f3a (Q-Tech CRM v1). Unchanged behaviour; header only.
export function generateCSV(headers: string[], rows: unknown[][]): string {
  const sanitize = (value: unknown): string => {
    if (value === null || value === undefined) return '""';
    let str = String(value);
    // Formula-injection guard: cells starting with = + - @ or tab/CR execute
    // as formulas when the CSV is opened in Excel. Prefix with ' to neutralize.
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };
  const headerRow = headers.map(sanitize).join(',');
  const dataRows = rows.map(row => row.map(sanitize).join(','));
  return [headerRow, ...dataRows].join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
