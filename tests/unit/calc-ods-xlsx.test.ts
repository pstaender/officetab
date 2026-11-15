// ODS -> model -> XLSX -> model: what both filters support survives the format change.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { ImportODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { ExportXLSX, ImportXLSX } from '../../src/lo/sc/source/filter/oox/xlsx.ts';
import { checkContent } from './calccsvcontent.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/ods/', import.meta.url);
const CASES: [string, string, number][] = [
  ['merged.ods', 'merged1.csv', 0], ['merged.ods', 'merged2.csv', 1], ['basic-cell-content.ods', '', 0], ['matrix.ods', 'matrix.csv', 0],
  ['functions.ods', 'logical-functions.csv', 0], ['repeatedColumns.ods', 'repeatedColumns1.csv', 0], ['dataValidity.ods', 'dataValidity1.csv', 0],
];

test.each(CASES)('%s through XLSX', async (file, csv, nTab) => {
  const ods = (await ImportODS(new Uint8Array(readFileSync(new URL(file, DATA))))).doc;
  const xlsx = (await ImportXLSX(await ExportXLSX(ods))).doc;
  const a = ods.GetDocument(), b = xlsx.GetDocument();
  expect(b.GetAllTableNames()).toEqual(a.GetAllTableNames());
  if (csv) expect(checkContent(b, nTab, csv).slice(0, 5)).toEqual([]);
  const { nEndCol, nEndRow } = a.GetCellArea(nTab);
  for (let r = 0; r <= Math.min(nEndRow, 60); r++) for (let c = 0; c <= Math.min(nEndCol, 30); c++) {
    const p = new ScAddress(c, r, nTab);
    expect(`${c},${r}:${b.GetString(p)}`).toBe(`${c},${r}:${a.GetString(p)}`);
    expect(b.GetPattern(p).GetItem('ATTR_MERGE')).toEqual(a.GetPattern(p).GetItem('ATTR_MERGE'));
  }
});
