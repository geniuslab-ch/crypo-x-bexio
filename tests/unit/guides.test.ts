import { describe, expect, it } from 'vitest';
import { IMPORTERS } from '@/core/importers';
import { exampleCsv, FORMAT_GUIDES } from '@/core/importers/guides';

describe('format guides', () => {
  it('has a guide for every importer, and each example file is accepted by its own parser', () => {
    for (const imp of IMPORTERS) {
      expect(FORMAT_GUIDES[imp.id], imp.id).toBeDefined();
      const csv = exampleCsv(imp.id)!;
      expect(imp.detect(csv), imp.id).toBe(true);
      const r = imp.parse(csv);
      expect(r.issues, imp.id).toEqual([]);
      expect(r.transactions.length, imp.id).toBe(1);
    }
  });
});
