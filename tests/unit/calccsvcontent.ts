// Helper for the Calc filter tests: not a port. Compares a sheet with one of upstream's expected
// content files (sc/qa/unit/data/contentCSV), as qahelper's testFile and csv_handler do: an empty
// field must be an empty cell, a number field the cell's value, anything else its string.
import { readFileSync } from 'node:fs';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';

export const CONTENT_CSV = new URL('../../upstream/core/sc/qa/unit/data/contentCSV/', import.meta.url);

/** orcus' csv parser with ',' and ';' as delimiters and '"' as the text qualifier. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, i = 0, wasQuoted = false;
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && !field) { quoted = true; wasQuoted = true; i++; continue; }
    if (c === ',' || c === ';') { row.push(field); field = ''; wasQuoted = false; i++; continue; }
    if (c === '\n' || c === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; wasQuoted = false;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field || row.length || wasQuoted) { row.push(field); rows.push(row); }
  return rows;
}

export function checkContent(doc: ScDocument, nTab: number, csvName: string, bPureString = false): string[] {
  const out: string[] = [];
  parseCsv(readFileSync(new URL(csvName, CONTENT_CSV), 'utf8')).forEach((row, nRow) => {
    row.forEach((v, nCol) => {
      const s = doc.GetString(nCol, nRow, nTab);
      if (!v) { if (s) out.push(`${nCol},${nRow}: expected empty, found '${s}'`); return; }
      if (bPureString) { if (s !== v.replace(/\n$/, '')) out.push(`${nCol},${nRow}: expected '${v}', found '${s}'`); return; }
      const n = Number(v.trim());
      if (v.trim() !== '' && !Number.isNaN(n) && /^[\s\d.eE+-]+$/.test(v)) {
        const f = doc.GetValue(nCol, nRow, nTab);
        if (!(Math.abs(f - n) <= 1e-10)) out.push(`${nCol},${nRow}: expected ${n}, found ${f}`);
      } else if (s !== v) out.push(`${nCol},${nRow}: expected '${v}', found '${s}'`);
    });
  });
  return out;
}
