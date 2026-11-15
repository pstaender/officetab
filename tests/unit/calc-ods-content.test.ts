// upstream's ODS import tests that compare sheets with contentCSV files (subsequent_filters_test*.cxx).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ImportODS } from '../../src/lo/sc/source/filter/xml/ods.ts';
import { checkContent } from './calccsvcontent.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/ods/', import.meta.url);
// Left out, as the model does not support them: bugFix_Sheet4.csv (native Thai digits),
// cachedValue.csv (fraction formats; formula results that take their references' formats),
// information-functions.csv and spreadsheet-functions.csv (CELL and HYPERLINK are recalculated
// on load and not ported).
const CASES: [string, string, number, boolean?][] = [
  ['bug-fixes.ods', 'bugFix_Sheet2.csv', 1],
  ['database-functions.ods', 'database-functions.csv', 0], ['dataValidity.ods', 'dataValidity1.csv', 0], ['dataValidity.ods', 'dataValidity2.csv', 1],
  ['dataValidity.ods', 'dataValidity3.csv', 2], ['date-time-functions.ods', 'date-time-functions.csv', 0, true], ['fdo36933test.ods', 'fdo36933test.csv', 0],
  ['fdo43700test.ods', 'fdo43700test.csv', 0], ['fdo64229b.ods', 'fdo64229b.csv', 0], ['functions.ods', 'financial-functions.csv', 6],
  ['functions.ods', 'logical-functions.csv', 0], ['functions.ods', 'mathematical-functions.csv', 2, true],
  ['functions.ods', 'statistical-functions.csv', 5], ['functions.ods', 'text-functions.csv', 4, true],
  ['hard-recalc.ods', 'hard-recalc.csv', 0], ['matrix.ods', 'matrix.csv', 0], ['matrix.ods', 'matrix2.csv', 1], ['matrix.ods', 'matrix3.csv', 2],
  ['merged.ods', 'merged1.csv', 0], ['merged.ods', 'merged2.csv', 1], ['named-ranges-global.ods', 'rangeExp_Sheet2.csv', 1],
  ['repeatedColumns.ods', 'repeatedColumns1.csv', 0], ['repeatedColumns.ods', 'repeatedColumns2.csv', 1], ['user-defined-function.ods', 'user-defined-function.csv', 0],
];

test.each(CASES)('%s matches %s', async (file, csv, nTab, pure) => {
  const { doc } = await ImportODS(new Uint8Array(readFileSync(new URL(file, DATA))));
  // testHardRecalcODS: the stored results are wrong on purpose; DoHardRecalc corrects them.
  if (file === 'hard-recalc.ods') doc.GetDocument().CalcAll();
  const errs = checkContent(doc.GetDocument(), nTab, csv, pure);
  expect(errs.slice(0, 8)).toEqual([]);
});
