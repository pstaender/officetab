// Statistical functions (interpr3.cxx, the statistics of interpr1.cxx, the gamma helpers of
// interpr6.cxx) and rtl::math::erf/erfc.
import { describe, expect, it } from 'vitest';
import { FormulaGrammar } from '../../src/lo/include/formula/grammar.ts';
import { erf, erfc } from '../../src/lo/sal/rtl/math.ts';
import { ScAddress } from '../../src/lo/sc/inc/address.ts';
import { ScMarkData } from '../../src/lo/sc/inc/markdata.ts';
import { ScSetStringParam } from '../../src/lo/sc/inc/stringutil.ts';
import { ScDocument } from '../../src/lo/sc/source/core/data/document.ts';
import { ScRangeData } from '../../src/lo/sc/source/core/tool/rangenam.ts';
import { calc, calcValue, newDoc, putAll } from './calchelper.ts';
import { STAT_CASES, STAT_SKIPPED, type StatSheetCase } from './calc-func-statistics.cases.ts';

/** Build the document of an upstream test sheet: values and texts first, then the formulas. */
function loadCase(c: StatSheetCase): ScDocument {
  const doc = new ScDocument();
  c.sheets.forEach((n, i) => {
    doc.MakeTable(i);
    doc.RenameTab(i, /^[A-Za-z0-9_]+$/.test(n) ? n : `Ext${i}`);
  });
  const rn = doc.GetRangeName()!;
  for (const [name, range, base] of c.names) {
    const aBase = new ScAddress();
    aBase.Parse(base.replace(/^\$/, ''), doc);
    rn.insert(new ScRangeData(doc, name, range.replace(/:\./, ':'), aBase));
  }
  doc.SetAutoCalc(false);
  const forms: [number, number, number, { f: string } | { m: [string, number, number] }][] = [];
  for (const [t, col, r0, vals] of c.cells) {
    vals.forEach((v, i) => {
      const row = r0 + i;
      if (v === null) return;
      if (typeof v === 'number') doc.SetValue(new ScAddress(col, row, t), v);
      else if (typeof v === 'string') {
        const p = new ScSetStringParam();
        p.setTextInput();
        doc.SetString(col, row, t, v, p);
      } else forms.push([t, col, row, v]);
    });
  }
  for (const [t, col, row, v] of forms) {
    if ('f' in v) doc.SetFormula(new ScAddress(col, row, t), v.f, FormulaGrammar.GRAM_ODFF);
    else {
      const [f, nCols, nRows] = v.m;
      const aMark = new ScMarkData(doc.GetSheetLimits());
      aMark.SelectOneTable(t);
      doc.InsertMatrixFormula(col, row, col + nCols - 1, row + nRows - 1, aMark, f, null, FormulaGrammar.GRAM_ODFF);
    }
  }
  doc.SetAutoCalc(true);
  doc.CalcAll();
  return doc;
}

describe('Calc statistical functions: upstream test sheets', () => {
  // sc/qa/unit/data/functions/statistical/fods/*.fods: the formulas of Sheet2's first column with
  // the result LibreOffice stored for them (a number, or the displayed text of an error).
  for (const c of STAT_CASES) {
    it(c.file, () => {
      const doc = loadCase(c);
      const aFailures: string[] = [];
      for (const [row, f, exp] of c.checks) {
        if (STAT_SKIPPED[`${c.file}:${row}`]) continue;
        const a = new ScAddress(0, row, 1);
        const s = doc.GetString(a);
        if (typeof exp === 'number') {
          const v = doc.GetValue(a);
          if (/^(Err:|#)/.test(s) || !(Math.abs(v - exp) <= 1e-9 * Math.max(1, Math.abs(exp)))) aFailures.push(`${f}: ${s}, expected ${exp}`);
        } else if (s !== exp) aFailures.push(`${f}: ${s}, expected ${exp}`);
      }
      expect(aFailures).toEqual([]);
    });
  }
});

describe('rtl::math::erf / erfc', () => {
  it('matches the C library', () => {
    // Values of the C library's erf/erfc.
    expect(erf(0.5)).toBe(0.5204998778130465);
    expect(erfc(3)).toBe(2.2090496998585438e-5);
    expect(erf(-1)).toBeCloseTo(-0.8427007929497149, 16);
    expect(erfc(-1)).toBeCloseTo(1.8427007929497148, 15);
    expect(erfc(10)).toBeCloseTo(2.088487583762545e-45, 58);
    expect(erf(0)).toBe(0);
    expect(erf(Infinity)).toBe(1);
    expect(erfc(Infinity)).toBe(0);
    expect(erfc(-Infinity)).toBe(2);
    expect(Number.isNaN(erf(NaN))).toBe(true);
  });
});

describe('Calc statistical functions', () => {
  it('computes the normal distribution', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=NORMSDIST(1)')).toBeCloseTo(0.841344746068543, 13);
    expect(calcValue(doc, '=NORM.S.DIST(-1;1)')).toBeCloseTo(0.158655253931457, 13);
    expect(calcValue(doc, '=NORM.S.DIST(0;0)')).toBeCloseTo(0.398942280401433, 13);
    expect(calcValue(doc, '=NORMDIST(70;63;5;1)')).toBeCloseTo(0.919243340766229, 13);
    expect(calcValue(doc, '=NORM.DIST(70;63;5;0)')).toBeCloseTo(0.029945493127149, 13);
    expect(calc(doc, '=NORMDIST(70;63;0;0)')).toBe('Err:502');
    expect(calcValue(doc, '=NORMSINV(0.908789)')).toBeCloseTo(1.33333467304411, 12);
    expect(calcValue(doc, '=NORM.INV(0.908789;40;1.5)')).toBeCloseTo(42.0000020095662, 11);
    expect(calc(doc, '=NORMINV(0;40;1.5)')).toBe('#VALUE!');
    expect(calcValue(doc, '=PHI(0)')).toBeCloseTo(0.398942280401433, 13);
    expect(calcValue(doc, '=GAUSS(1)')).toBeCloseTo(0.341344746068543, 13);
    expect(calcValue(doc, '=STANDARDIZE(42;40;1.5)')).toBeCloseTo(1.33333333333333, 12);
    expect(calcValue(doc, '=LOGNORMDIST(4;3.5;1.2)')).toBeCloseTo(0.0390835557068005, 13);
    expect(calcValue(doc, '=LOGNORM.DIST(4;3.5;1.2;0)')).toBeCloseTo(0.0176175966818192, 13);
    expect(calcValue(doc, '=LOGINV(0.0390835557068;3.5;1.2)')).toBeCloseTo(3.99999999999997, 12);
    expect(calcValue(doc, '=CONFIDENCE(0.05;2.5;50)')).toBeCloseTo(0.692951912174839, 13);
    expect(calcValue(doc, '=CONFIDENCE.T(0.05;1;50)')).toBeCloseTo(0.28419685549573, 12);
  });

  it('computes the gamma, beta, t, chi-square and F distributions', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=GAMMA(2.5)')).toBeCloseTo(1.32934038817914, 12);
    expect(calc(doc, '=GAMMA(-2)')).toBe('Err:502');
    expect(calcValue(doc, '=GAMMALN(4)')).toBeCloseTo(1.79175946922806, 12);
    expect(calcValue(doc, '=GAMMADIST(10;9;2;0)')).toBeCloseTo(0.0326390196740794, 13);
    expect(calcValue(doc, '=GAMMA.DIST(10;9;2;1)')).toBeCloseTo(0.0680936347218484, 13);
    expect(calcValue(doc, '=GAMMAINV(0.068094;9;2)')).toBeCloseTo(10.0000111914372, 11);
    expect(calcValue(doc, '=BETADIST(2;8;10;1;3)')).toBeCloseTo(0.685470581054688, 13);
    expect(calcValue(doc, '=BETA.DIST(2;8;10;0;1;3)')).toBeCloseTo(1.4837646484375, 11);
    expect(calcValue(doc, '=BETAINV(0.685470581054688;8;10;1;3)')).toBeCloseTo(2, 9);
    expect(calcValue(doc, '=TDIST(1.96;60;2)')).toBeCloseTo(0.0546449297365293, 13);
    expect(calcValue(doc, '=T.DIST(1;10;1)')).toBeCloseTo(0.82955343384897, 12);
    expect(calcValue(doc, '=T.DIST.RT(-1;10)')).toBeCloseTo(0.82955343384897, 12);
    expect(calcValue(doc, '=TINV(0.054644929975;60)')).toBeCloseTo(1.95999999800769, 12);
    expect(calcValue(doc, '=T.INV(0.75;2)')).toBeCloseTo(0.816496580927726, 13);
    expect(calcValue(doc, '=CHIDIST(18.307;10)')).toBeCloseTo(0.0500005890913981, 13);
    expect(calcValue(doc, '=CHIINV(0.050001;10)')).toBeCloseTo(18.3069734569611, 11);
    expect(calcValue(doc, '=CHISQ.DIST(0.5;1;1)')).toBeCloseTo(0.520499877813047, 13);
    expect(calcValue(doc, '=CHISQ.INV(0.93;1)')).toBeCloseTo(3.28302028675954, 12);
    expect(calcValue(doc, '=FDIST(15.2069;6;4)')).toBeCloseTo(0.00999995699723731, 13);
    expect(calcValue(doc, '=F.DIST(15.2069;6;4;1)')).toBeCloseTo(0.990000043002763, 13);
    expect(calcValue(doc, '=FINV(0.01;6;4)')).toBeCloseTo(15.2068648611575, 11);
    expect(calcValue(doc, '=F.INV(0.01;6;4)')).toBeCloseTo(0.109309914124579, 13);
    expect(calcValue(doc, '=WEIBULL(105;20;100;1)')).toBeCloseTo(0.929581390069277, 13);
    expect(calcValue(doc, '=EXPONDIST(0.2;10;1)')).toBeCloseTo(0.864664716763387, 13);
  });

  it('computes the discrete distributions and combinatorics', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=BINOMDIST(6;10;0.5;0)')).toBeCloseTo(0.205078125, 7);
    expect(calcValue(doc, '=BINOM.DIST(6;10;0.5;1)')).toBeCloseTo(0.828125, 4);
    expect(calcValue(doc, '=B(10;0.5;6;7)')).toBeCloseTo(0.322265625, 7);
    expect(calcValue(doc, '=CRITBINOM(6;0.5;0.75)')).toBe(4);
    expect(calcValue(doc, '=BINOM.INV(6;0.5;0.75)')).toBe(4);
    expect(calcValue(doc, '=NEGBINOMDIST(10;5;0.25)')).toBeCloseTo(0.0550486603751779, 13);
    expect(calcValue(doc, '=NEGBINOM.DIST(10;5;0.25;1)')).toBeCloseTo(0.313514058478177, 13);
    expect(calcValue(doc, '=POISSON(2;5;0)')).toBeCloseTo(0.0842243374885683, 13);
    expect(calcValue(doc, '=POISSON.DIST(2;5;1)')).toBeCloseTo(0.124652019483081, 13);
    expect(calcValue(doc, '=HYPGEOMDIST(1;4;8;20)')).toBeCloseTo(0.363261093911249, 13);
    expect(calcValue(doc, '=HYPGEOM.DIST(1;4;8;20;1)')).toBeCloseTo(0.465428276573787, 13);
    expect(calcValue(doc, '=COMBIN(8;2)')).toBe(28);
    expect(calcValue(doc, '=COMBINA(4;3)')).toBe(20);
    expect(calcValue(doc, '=PERMUT(100;3)')).toBe(970200);
    expect(calcValue(doc, '=PERMUTATIONA(3;2)')).toBe(9);
    expect(calcValue(doc, '=FACT(5)')).toBe(120);
    expect(calc(doc, '=COMBIN(2;3)')).toBe('Err:502');
    expect(calcValue(doc, '=FISHER(0.75)')).toBeCloseTo(0.972955074527657, 13);
    expect(calcValue(doc, '=FISHERINV(0.972955074527657)')).toBeCloseTo(0.75, 3);
  });

  it('computes descriptive statistics of ranges', () => {
    const doc = newDoc();
    putAll(doc, { A1: 3, A2: 1, A3: 4, A4: 1, A5: 5, A6: 9, A7: 2, A8: 6, A9: 'text', A10: 5 });
    expect(calcValue(doc, '=MEDIAN(A1:A10)')).toBe(4);
    expect(calcValue(doc, '=MEDIAN(A1:A8)')).toBeCloseTo(3.5, 3);
    expect(calcValue(doc, '=MODE(A1:A10)')).toBe(1);
    expect(calcValue(doc, '=MODE.SNGL(A1:A10)')).toBe(1);
    expect(calcValue(doc, '=LARGE(A1:A10;2)')).toBe(6);
    expect(calcValue(doc, '=SMALL(A1:A10;3)')).toBe(2);
    expect(calc(doc, '=SMALL(A1:A10;10)')).toBe('#VALUE!');
    expect(calcValue(doc, '=PERCENTILE(A1:A10;0.3)')).toBeCloseTo(2.4, 3);
    expect(calcValue(doc, '=PERCENTILE.EXC(A1:A10;0.3)')).toBe(2);
    expect(calcValue(doc, '=QUARTILE(A1:A10;1)')).toBe(2);
    expect(calcValue(doc, '=QUARTILE.EXC(A1:A10;3)')).toBeCloseTo(5.5, 3);
    expect(calcValue(doc, '=PERCENTRANK(A1:A10;4)')).toBeCloseTo(0.5, 3);
    expect(calcValue(doc, '=PERCENTRANK.EXC(A1:A10;4)')).toBeCloseTo(0.5, 3);
    expect(calcValue(doc, '=RANK(5;A1:A10)')).toBe(3);
    expect(calcValue(doc, '=RANK.EQ(1;A1:A10;1)')).toBe(1);
    expect(calcValue(doc, '=RANK.AVG(1;A1:A10;1)')).toBeCloseTo(1.5, 3);
    expect(calc(doc, '=RANK(7;A1:A10)')).toBe('#N/A');
    expect(calcValue(doc, '=AVEDEV(A1:A10)')).toBe(2);
    expect(calcValue(doc, '=DEVSQ(A1:A10)')).toBe(54);
    expect(calcValue(doc, '=GEOMEAN(A1:A10)')).toBeCloseTo(3.17082057642821, 12);
    expect(calcValue(doc, '=HARMEAN(A1:A10)')).toBeCloseTo(2.39290989660266, 12);
    expect(calcValue(doc, '=KURT(A1:A10)')).toBeCloseTo(0.261022927689594, 13);
    expect(calcValue(doc, '=SKEW(A1:A10)')).toBeCloseTo(0.659828879073858, 13);
    expect(calcValue(doc, '=SKEWP(A1:A10)')).toBeCloseTo(0.544331053951817, 13);
    expect(calcValue(doc, '=TRIMMEAN(A1:A10;0.25)')).toBeCloseTo(3.71428571428571, 12);
    expect(calcValue(doc, '=VAR(A1:A10)')).toBeCloseTo(6.75, 3);
    expect(calcValue(doc, '=VAR.P(A1:A10)')).toBe(6);
    expect(calcValue(doc, '=VARA(A1:A10)')).toBeCloseTo(7.6, 3);
    expect(calcValue(doc, '=VARPA(A1:A10)')).toBeCloseTo(6.84, 3);
    expect(calcValue(doc, '=STDEV(A1:A10)')).toBeCloseTo(2.59807621135332, 12);
    expect(calcValue(doc, '=STDEV.P(A1:A10)')).toBeCloseTo(2.44948974278318, 12);
    expect(calcValue(doc, '=STDEVA(A1:A10)')).toBeCloseTo(2.75680975041804, 12);
    expect(calcValue(doc, '=STDEVPA(A1:A10)')).toBeCloseTo(2.6153393661244, 11);
    expect(calc(doc, '=VAR(1)')).toBe('#DIV/0!');
    expect(calc(doc, '=STDEVP()')).toBe('#DIV/0!');
    expect(calc(doc, '=GEOMEAN(1;-1)')).toBe('Err:502');
    expect(calcValue(doc, '=GEOMEAN(1;0;4)')).toBe(0);
  });

  it('returns MODE.MULT as a column', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, A4: 4, A5: 3, A6: 2, A7: 1, A8: 2, A9: 3 });
    expect(calcValue(doc, '=INDEX(MODE.MULT(A1:A9);1)')).toBe(2);
    expect(calcValue(doc, '=INDEX(MODE.MULT(A1:A9);2)')).toBe(3);
    expect(calcValue(doc, '=ROWS(MODE.MULT(A1:A9))')).toBe(2);
  });

  it('computes two-sample statistics', () => {
    const doc = newDoc();
    putAll(doc, { A1: 2, A2: 3, A3: 9, A4: 1, A5: 8, A6: 7, A7: 5, B1: 6, B2: 5, B3: 11, B4: 7, B5: 5, B6: 4, B7: 4 });
    expect(calcValue(doc, '=CORREL(A1:A7;B1:B7)')).toBeCloseTo(0.240728460242825, 13);
    expect(calcValue(doc, '=PEARSON(A1:A7;B1:B7)')).toBeCloseTo(0.240728460242825, 13);
    expect(calcValue(doc, '=RSQ(A1:A7;B1:B7)')).toBeCloseTo(0.0579501915708812, 13);
    expect(calcValue(doc, '=SLOPE(A1:A7;B1:B7)')).toBeCloseTo(0.305555555555556, 13);
    expect(calcValue(doc, '=INTERCEPT(A1:A7;B1:B7)')).toBeCloseTo(3.16666666666667, 12);
    expect(calcValue(doc, '=STEYX(A1:A7;B1:B7)')).toBeCloseTo(3.30571895021004, 12);
    expect(calcValue(doc, '=COVAR(A1:A7;B1:B7)')).toBeCloseTo(1.57142857142857, 12);
    expect(calcValue(doc, '=COVARIANCE.S(A1:A7;B1:B7)')).toBeCloseTo(1.83333333333333, 12);
    expect(calcValue(doc, '=FORECAST(5;A1:A7;B1:B7)')).toBeCloseTo(4.69444444444445, 12);
    expect(calcValue(doc, '=FORECAST.LINEAR(5;A1:A7;B1:B7)')).toBeCloseTo(4.69444444444445, 12);
    expect(calc(doc, '=CORREL(A1:A7;B1:B6)')).toBe('Err:502');
    expect(calcValue(doc, '=TTEST(A1:A7;B1:B7;2;2)')).toBeCloseTo(0.516506465672336, 13);
    expect(calcValue(doc, '=T.TEST(A1:A7;B1:B7;2;3)')).toBeCloseTo(0.517187124207753, 13);
    expect(calcValue(doc, '=FTEST(A1:A7;B1:B7)')).toBeCloseTo(0.576931748943634, 13);
    expect(calcValue(doc, '=ZTEST(A1:A7;4)')).toBeCloseTo(0.197394968962934, 13);
    putAll(doc, { C1: 58, C2: 11, C3: 10, D1: 45.35, D2: 17.56, D3: 16.09, E1: 0.2, E2: 0.3, E3: 0.1, E4: 0.4 });
    expect(calcValue(doc, '=CHITEST(C1:C3;D1:D3)')).toBeCloseTo(0.0158885604470874, 13);
    expect(calcValue(doc, '=PROB(A1:A4;E1:E4;2;3)')).toBeCloseTo(0.5, 3);
    expect(calc(doc, '=PROB(A1:A4;E1:E3;2)')).toBe('#N/A');
  });

  it('honours the subtotal flags through AGGREGATE', () => {
    const doc = newDoc();
    putAll(doc, { A1: 3, A2: '=1/0', A3: 1, A4: 7 });
    expect(calc(doc, '=MEDIAN(A1:A4)')).toBe('#DIV/0!');
    // AGGREGATE(12, 6, ...): MEDIAN ignoring error values
    expect(calcValue(doc, '=AGGREGATE(12;6;A1:A4)')).toBe(3);
    expect(calcValue(doc, '=AGGREGATE(14;6;A1:A4;1)')).toBe(7);
    expect(calcValue(doc, '=AGGREGATE(7;6;A1:A4)')).toBeCloseTo(3.05505046330389, 12);
  });
});
