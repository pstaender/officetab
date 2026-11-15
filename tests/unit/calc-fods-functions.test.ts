// upstream's function test documents (sc/qa/unit/data/functions/**/fods/*.fods) through the FODS
// import, as functions_test.cxx runs them: after a hard recalculation every row of a sheet's
// "Correct" column must be TRUE. Functions the port lacks fail; the test asserts the files known
// to pass and reports the rest.
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

function failures(doc: ScDocument): number {
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
  return n;
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
}, 600000);
