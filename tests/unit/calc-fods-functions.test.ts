// upstream's function test documents (sc/qa/unit/data/functions/**/fods/*.fods) through the FODS
// import, as functions_test.cxx runs them: after a hard recalculation the summary cell
// Sheet1.B3 must be TRUE (every row of the sheets' "Correct" columns is). Functions the port lacks
// fail; the test asserts that the files in calc-fods-functions.pass.json pass and reports the rest.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { SetGlobalConfig } from '../../src/lo/sc/source/core/tool/interpr1.ts';
import type { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { ImportFODS } from '../../src/lo/sc/source/filter/xml/ods.ts';

const DIR = new URL('../../upstream/core/sc/qa/unit/data/functions/', import.meta.url);
const files = readdirSync(DIR).flatMap((cat) => {
  try { return readdirSync(new URL(`${cat}/fods/`, DIR)).filter((f) => f.endsWith('.fods')).map((f) => `${cat}/fods/${f}`); } catch { return []; }
});

const KNOWN_GOOD: string[] = JSON.parse(readFileSync(new URL('./calc-fods-functions.pass.json', import.meta.url), 'utf8'));

function failures(doc: ScDocument): number {
  // functions_test.cxx: the summary cell Sheet1.B3 is 1 when all checks pass
  if (Math.abs(doc.GetValue(1, 2, 0) - 1) < 1e-14) return 0;
  let n = 0;
  for (let nTab = 1; nTab < doc.GetTableCount(); nTab++) {
    let nExpectedCol = 0, nCorrectCol = 0;
    for (let c = 0; c <= 200; ++c) {
      const s = doc.GetString(c, 0, nTab);
      if (s === 'Expected') nExpectedCol = c;
      else if (s === 'Correct') nCorrectCol = c;
      else if (s === 'FunctionString') break;
    }
    if (!nExpectedCol || !nCorrectCol) continue;
    const maxRow = doc.GetLastDataRow(nTab, nCorrectCol, nCorrectCol, doc.MaxRow());
    for (let row = 1; row <= maxRow; ++row) {
      if (!doc.HasData(nCorrectCol, row, nTab)) continue;
      if (Math.abs(doc.GetValue(nCorrectCol, row, nTab) - 1) >= 1e-14) n++;
    }
  }
  return Math.max(1, n); // (the rows that fail, at least the summary)
}

test('function test documents', () => {
  SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_A1_XL_A1 });
  const pass: string[] = [], fail: string[] = [];
  try {
    for (const f of files) {
      const { doc } = ImportFODS(readFileSync(new URL(f, DIR), 'utf8'));
      const d = doc.GetDocument();
      d.CalcAll();
      (failures(d) ? fail : pass).push(f);
    }
  } finally {
    SetGlobalConfig({ meStringRefAddressSyntax: FormulaGrammar.CONV_UNSPECIFIED });
  }
  console.log(`function documents: ${pass.length} pass, ${fail.length} fail`);
  console.log(`PASS ${JSON.stringify(pass)}`);
  expect(pass.length + fail.length).toBe(files.length);
  expect(KNOWN_GOOD.filter((f) => !pass.includes(f))).toEqual([]);
}, 600000);
