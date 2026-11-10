import { describe, expect, it } from 'vitest';
import { reportToCsv, safeCell } from '@/server/services/reports';

describe('CSV export safety', () => {
  it('neutralises formula-leading text but keeps numbers', () => {
    expect(safeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(safeCell('+1+1')).toBe("'+1+1");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('-12.50')).toBe('-12.50');
    expect(safeCell('BTC')).toBe('BTC');
    expect(safeCell(3)).toBe(3);
    const csv = reportToCsv({ title: 't', meta: [], columns: ['a'], rows: [['=1+1']] });
    expect(csv).toContain("'=1+1");
  });
});
