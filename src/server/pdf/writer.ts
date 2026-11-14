import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Small PDF layout helper on top of pdf-lib (pure JavaScript, no native dependency): A4 landscape pages with a
 * header line, page numbers, headings, key/value blocks and tables that continue on the next page.
 * Standard PDF fonts only cover WinAnsi characters: anything else is replaced by a close ASCII equivalent.
 */
const W = 842;
const H = 595;
const M = 36;
const GOLD = rgb(0.72, 0.56, 0.2);
const GREY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.85, 0.85, 0.85);

const REPLACE: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '≤': '<=', '≥': '>=', '−': '-', '✓': 'OK', '×': 'x', '…': '...', ' ': ' ', ' ': ' ' };

export interface Table {
  columns: string[];
  rows: (string | number | null)[][];
  /** Relative column widths; computed from the content when omitted. */
  widths?: number[];
  /** Columns aligned right (numbers). */
  numeric?: number[];
}

export class PdfWriter {
  private doc!: PDFDocument;
  private font!: PDFFont;
  private bold!: PDFFont;
  private page!: PDFPage;
  private y = 0;
  private readonly encodable = new Map<string, boolean>();

  constructor(private header: string) {}

  async init() {
    this.doc = await PDFDocument.create();
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.doc.setTitle(this.header);
    this.doc.setProducer('Crypto2Books');
    this.doc.setCreator('Crypto2Books');
    this.newPage();
    return this;
  }

  /** Text the standard fonts can draw. */
  safe(text: string | number | null | undefined): string {
    let out = '';
    for (const ch of String(text ?? '')) {
      if (REPLACE[ch] !== undefined) { out += REPLACE[ch]; continue; }
      let ok = this.encodable.get(ch);
      if (ok === undefined) {
        try { this.font.encodeText(ch); ok = true; } catch { ok = false; }
        this.encodable.set(ch, ok);
      }
      out += ok ? ch : ch.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || '?';
    }
    return out.replace(/[\r\n\t]+/g, ' ');
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.page.drawText(this.safe(this.header), { x: M, y: H - 24, size: 8, font: this.font, color: GREY });
    this.page.drawLine({ start: { x: M, y: H - 28 }, end: { x: W - M, y: H - 28 }, thickness: 0.5, color: GOLD });
    this.y = H - 48;
  }

  private ensure(height: number) {
    if (this.y - height < M + 10) this.newPage();
  }

  title(text: string, size = 22) {
    this.ensure(size + 10);
    this.page.drawText(this.safe(text), { x: M, y: this.y - size, size, font: this.bold });
    this.y -= size + 12;
  }

  heading(text: string) {
    this.ensure(60);
    this.y -= 6;
    this.page.drawText(this.safe(text), { x: M, y: this.y - 13, size: 13, font: this.bold, color: rgb(0, 0, 0) });
    this.page.drawLine({ start: { x: M, y: this.y - 17 }, end: { x: M + 120, y: this.y - 17 }, thickness: 1.5, color: GOLD });
    this.y -= 26;
  }

  paragraph(text: string, size = 9, color = rgb(0.1, 0.1, 0.1)) {
    for (const line of this.wrap(this.safe(text), W - 2 * M, size, this.font)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: M, y: this.y - size, size, font: this.font, color });
      this.y -= size + 3;
    }
    this.y -= 4;
  }

  keyValues(pairs: [string, string][], size = 9) {
    const keyW = 190;
    for (const [k, v] of pairs) {
      const lines = this.wrap(this.safe(v), W - 2 * M - keyW, size, this.font);
      this.ensure((size + 3) * lines.length + 2);
      this.page.drawText(this.fit(this.safe(k), keyW - 8, size, this.bold), { x: M, y: this.y - size, size, font: this.bold, color: GREY });
      lines.forEach((l, i) => this.page.drawText(l, { x: M + keyW, y: this.y - size - i * (size + 3), size, font: this.font }));
      this.y -= (size + 3) * lines.length + 2;
    }
    this.y -= 6;
  }

  table(t: Table, size = 7) {
    if (t.rows.length === 0) { this.paragraph('Aucune ligne.', 9, GREY); return; }
    const total = W - 2 * M;
    const rel = t.widths ?? t.columns.map((c, i) => Math.min(40, Math.max(6, c.length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? '').length))));
    const sum = rel.reduce((a, b) => a + b, 0);
    const widths = rel.map((r) => (r / sum) * total);
    const rowH = size + 5;
    const drawHeader = () => {
      this.ensure(rowH * 2);
      let x = M;
      this.page.drawRectangle({ x: M, y: this.y - rowH, width: total, height: rowH, color: rgb(0.95, 0.93, 0.88) });
      t.columns.forEach((c, i) => {
        this.page.drawText(this.fit(this.safe(c), widths[i]! - 4, size, this.bold), { x: x + 2, y: this.y - size - 1, size, font: this.bold });
        x += widths[i]!;
      });
      this.y -= rowH;
    };
    drawHeader();
    for (const r of t.rows) {
      if (this.y - rowH < M + 10) { this.newPage(); drawHeader(); }
      let x = M;
      const isTotal = typeof r[0] === 'string' && r[0].startsWith('TOTAL');
      r.forEach((cell, i) => {
        const font = isTotal ? this.bold : this.font;
        const text = this.fit(this.safe(cell ?? ''), widths[i]! - 4, size, font);
        const tw = font.widthOfTextAtSize(text, size);
        const right = t.numeric?.includes(i);
        this.page.drawText(text, { x: right ? x + widths[i]! - 2 - tw : x + 2, y: this.y - size - 1, size, font });
        x += widths[i]!;
      });
      this.page.drawLine({ start: { x: M, y: this.y - rowH }, end: { x: M + total, y: this.y - rowH }, thickness: 0.3, color: LINE });
      this.y -= rowH;
    }
    this.y -= 8;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: W - M - 30, y: 18, size: 8, font: this.font, color: GREY }));
    return this.doc.save();
  }

  private fit(text: string, width: number, size: number, font: PDFFont): string {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  }

  private wrap(text: string, width: number, size: number, font: PDFFont): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) cur = next;
      else { if (cur) lines.push(cur); cur = this.fit(w, width, size, font); }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
}
