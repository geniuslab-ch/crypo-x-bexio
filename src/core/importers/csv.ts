import Papa from 'papaparse';

export interface CsvTable {
  headers: string[];
  /** Rows as header→value maps. */
  rows: Record<string, string>[];
  /** 1-based line number in the original file for each row. */
  lineNumbers: number[];
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Parses CSV text. Some exchanges prepend preamble lines (titles, user info) before the real header,
 * so the header row is the first row containing all `requiredHeaders` (case-insensitive).
 * Returns null when no such header row exists — callers must refuse the file rather than guess.
 */
export function readCsv(text: string, requiredHeaders: string[]): CsvTable | null {
  const parsed = Papa.parse<string[]>(stripBom(text), { skipEmptyLines: false });
  const data = parsed.data;
  const required = requiredHeaders.map((h) => h.toLowerCase());
  let headerIdx = -1;
  for (let i = 0; i < Math.min(data.length, 50); i++) {
    const cells = (data[i] ?? []).map((c) => c.trim().toLowerCase());
    if (required.every((r) => cells.includes(r))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;
  const headers = (data[headerIdx] ?? []).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const cells = data[i] ?? [];
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') continue;
    if (cells.every((c) => c.trim() === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (cells[j] ?? '').trim();
    });
    rows.push(row);
    lineNumbers.push(i + 1);
  }
  return { headers, rows, lineNumbers };
}

/** Case-insensitive header lookup. */
export function col(row: Record<string, string>, name: string): string {
  if (name in row) return row[name] ?? '';
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (row[key] ?? '') : '';
}

/** Parses a timestamp; dates without timezone are interpreted as UTC (documented per parser). */
export function parseTimestamp(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  // "2024-01-15 10:23:45" or "2024-01-15 10:23:45.1234" → treat as UTC
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2}(\.\d+)?)?)$/.exec(v);
  const iso = m ? `${m[1]}T${m[2]}Z` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v.replace(' UTC', 'Z').replace(/ (?=Z$)/, '');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
