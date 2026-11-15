// The Analysis add-in (scaddins/source/analysis): its methods called directly, the component
// surface the add-in collection reads, and the functions through formulas.
import { describe, expect, test } from 'vitest';
import { IllegalArgumentException, NoConvergenceException, RuntimeException, type XPropertySet } from '../../src/lo/sc/inc/addincol.ts';
import { AnalysisAddIn } from '../../src/lo/scaddins/source/analysis/analysis.ts';
import { Complex, ConvertDataList, DateToDays, DaysToDate, GetString, ScaDate } from '../../src/lo/scaddins/source/analysis/analysishelper.ts';
import { calc, calcValue, newDoc, putAll } from './calchelper.ts';

const xOpt: XPropertySet = { getPropertyValue: (s: string) => (s === 'NullDate' ? { Day: 30, Month: 12, Year: 1899 } : undefined) };
const a = new AnalysisAddIn();
a.setLocale({ Language: 'en', Country: 'US' });
// serial numbers of dates (null date 1899-12-30)
const D = (y: number, m: number, d: number) => DateToDays(d, m, y) - DateToDays(30, 12, 1899);

describe('analysishelper', () => {
  test('DateToDays and DaysToDate are inverse', () => {
    for (const n of [1, 59, 60, 365, 366, 693594, 693595, 730000, 800000]) {
      const [d, m, y] = DaysToDate(n);
      expect(DateToDays(d, m, y)).toBe(n);
    }
    expect(DateToDays(1, 1, 1)).toBe(1);
    expect(D(2011, 1, 31)).toBe(40574);
    expect(() => DaysToDate(-1)).toThrow(IllegalArgumentException);
  });

  test('GetString prints like printf %.15g', () => {
    expect(GetString(1, false)).toBe('1');
    expect(GetString(0.1, false)).toBe('0.1');
    expect(GetString(1 / 3, false)).toBe('0.333333333333333');
    expect(GetString(1e20, false)).toBe('1e+20');
    expect(GetString(1.5e-7, false)).toBe('1.5e-07');
    expect(GetString(123456789012345678, false)).toBe('1.23456789012346e+17');
    expect(GetString(4, true)).toBe('+4');
    expect(GetString(-4, true)).toBe('-4');
  });

  test('Complex parses and prints', () => {
    const s = (t: string) => new Complex(t).GetString();
    expect(s('3+4i')).toBe('3+4i');
    expect(s('3-4j')).toBe('3-4j');
    expect(s('i')).toBe('i');
    expect(s('-i')).toBe('-i');
    expect(s('4.5')).toBe('4.5');
    expect(s('1e2+1.5e1i')).toBe('100+15i');
    expect(s('2i')).toBe('2i');
    expect(() => new Complex('3+4')).toThrow(IllegalArgumentException);
    expect(() => new Complex('x')).toThrow(IllegalArgumentException);
  });

  test('ScaDate keeps the end of month', () => {
    const nNull = DateToDays(30, 12, 1899);
    const d = new ScaDate(nNull, D(2011, 1, 31), 1);
    d.addMonths(1);
    expect(d.getDate(nNull)).toBe(D(2011, 2, 28));
    d.addMonths(1);
    expect(d.getDate(nNull)).toBe(D(2011, 3, 31));
  });

  test('ConvertDataList', () => {
    const c = new ConvertDataList();
    expect(c.Convert(68, 'F', 'C')).toBeCloseTo(20, 12);
    expect(c.Convert(1, 'lbm', 'kg')).toBeCloseTo(0.45359237, 6);
    expect(c.Convert(1, 'km', 'm')).toBeCloseTo(1000, 10);
    expect(c.Convert(100, 'cm2', 'm2')).toBeCloseTo(0.01, 14);
    expect(c.Convert(1, 'kibyte', 'bit')).toBe(8192);
    expect(c.Convert(1, 'kbyte', 'bit')).toBeCloseTo(8000, 9);
    expect(c.Convert(1, 'm^2', 'cm^2')).toBeCloseTo(10000, 9);
    expect(() => c.Convert(1, 'ft', 'sec')).toThrow(IllegalArgumentException);
    expect(() => c.Convert(1, 'foo', 'm')).toThrow(IllegalArgumentException);
  });
});

describe('AnalysisAddIn methods', () => {
  test('date functions', () => {
    expect(a.getEdate(xOpt, D(2011, 1, 31), 1)).toBe(D(2011, 2, 28));
    expect(a.getEdate(xOpt, D(2011, 1, 31), -2)).toBe(D(2010, 11, 30));
    expect(a.getEomonth(xOpt, D(2011, 1, 1), 1)).toBe(D(2011, 2, 28));
    expect(a.getEomonth(xOpt, D(2011, 1, 1), -3)).toBe(D(2010, 10, 31));
    expect(a.getEomonth(xOpt, D(2011, 12, 15), 12)).toBe(D(2012, 12, 31));
    const hol = [[D(2008, 11, 26)], [D(2008, 12, 4)], [D(2009, 1, 21)]];
    expect(a.getWorkday(xOpt, D(2008, 10, 1), 151, hol)).toBe(D(2009, 5, 5));
    expect(a.getWorkday(xOpt, D(2008, 10, 1), 151, undefined)).toBe(D(2009, 4, 30));
    expect(a.getWorkday(xOpt, D(2008, 10, 1), -10, undefined)).toBe(D(2008, 9, 17));
    const hol2 = [[D(2012, 11, 22)], [D(2012, 12, 4)], [D(2013, 1, 21)]];
    expect(a.getNetworkdays(xOpt, D(2012, 10, 1), D(2013, 3, 1), undefined)).toBe(110);
    expect(a.getNetworkdays(xOpt, D(2012, 10, 1), D(2013, 3, 1), D(2012, 11, 22))).toBe(109);
    expect(a.getNetworkdays(xOpt, D(2012, 10, 1), D(2013, 3, 1), hol2)).toBe(107);
    expect(a.getNetworkdays(xOpt, D(2013, 3, 1), D(2012, 10, 1), undefined)).toBe(-110);
    expect(a.getYearfrac(xOpt, D(2012, 1, 1), D(2012, 7, 30), undefined)).toBeCloseTo(0.580555556, 8);
    expect(a.getYearfrac(xOpt, D(2012, 1, 1), D(2012, 7, 30), 1)).toBeCloseTo(0.576502732, 8);
    expect(a.getYearfrac(xOpt, D(2012, 1, 1), D(2012, 7, 30), 3)).toBeCloseTo(0.578082192, 8);
    expect(() => a.getYearfrac(xOpt, 1, 2, 5)).toThrow(IllegalArgumentException);
    expect(a.getWeeknum(xOpt, D(2012, 3, 9), 1)).toBe(10);
    expect(a.getWeeknum(xOpt, D(2012, 3, 9), 2)).toBe(11);
    expect(() => a.getEdate(undefined, 1, 1)).toThrow(RuntimeException);
  });

  test('math functions', () => {
    expect(a.getIseven(-1)).toBe(0);
    expect(a.getIseven(2)).toBe(1);
    expect(a.getIsodd(5)).toBe(1);
    expect(a.getMround(10, 3)).toBe(9);
    expect(a.getMround(-10, -3)).toBe(-9);
    expect(a.getMround(1.3, 0.2)).toBeCloseTo(1.4, 14);
    expect(a.getQuotient(5, 2)).toBe(2);
    expect(a.getQuotient(-10, 3)).toBe(-3);
    expect(a.getGcd(xOpt, [[24, 36]], [])).toBe(12);
    expect(a.getGcd(xOpt, [[5]], [2])).toBe(1);
    expect(a.getLcm(xOpt, [[24]], [36, [[8]]])).toBe(72);
    expect(() => a.getGcd(xOpt, [[-1]], [])).toThrow(IllegalArgumentException);
    expect(a.getMultinomial(xOpt, [[2, 3, 4]], [])).toBe(1260);
    expect(a.getSeriessum(2, 1, 2, [[1, 2, 3]])).toBe(114);
    expect(() => a.getSeriessum(0, 0, 1, [[1]])).toThrow(RuntimeException);
    expect(a.getSqrtpi(1)).toBeCloseTo(1.772453850905516, 14);
    expect(() => a.getSqrtpi(-1)).toThrow(IllegalArgumentException);
    for (let i = 0; i < 50; i++) {
      const r = a.getRandbetween(1, 6);
      expect(Number.isInteger(r) && r >= 1 && r <= 6).toBe(true);
    }
    expect(() => a.getRandbetween(2, 1)).toThrow(IllegalArgumentException);
    expect(a.getFactdouble(6)).toBe(48);
    expect(a.getFactdouble(7)).toBe(105);
    expect(a.getFactdouble(0)).toBe(1);
    expect(() => a.getFactdouble(-1)).toThrow(IllegalArgumentException);
  });

  test('engineering functions', () => {
    expect(a.getDelta(xOpt, 5, 4)).toBe(0);
    expect(a.getDelta(xOpt, 5, 5)).toBe(1);
    expect(a.getDelta(xOpt, 0, undefined)).toBe(1);
    expect(a.getGestep(xOpt, 5, 4)).toBe(1);
    expect(a.getGestep(xOpt, -4, -5)).toBe(1);
    expect(a.getGestep(xOpt, -1, undefined)).toBe(0);
    expect(a.getErf(xOpt, 1, undefined)).toBeCloseTo(0.8427007929497149, 15);
    expect(a.getErf(xOpt, 0, 1.5)).toBeCloseTo(0.966105146, 9);
    expect(a.getErfc(1)).toBeCloseTo(0.15729920705028513, 15);
    expect(a.getBesselj(1.9, 2)).toBeCloseTo(0.329925728, 9);
    expect(a.getBesseli(1.5, 1)).toBeCloseTo(0.981666428, 8);
    expect(a.getBesselk(1.5, 1)).toBeCloseTo(0.277387804, 8);
    expect(a.getBessely(2.5, 1)).toBeCloseTo(0.145918138, 9);
    expect(() => a.getBesselk(0, 1)).toThrow(IllegalArgumentException);
    expect(() => a.getBesselj(1, -1)).toThrow(IllegalArgumentException);
    expect(() => a.getBesselj(1e7, 1000000)).toThrow(NoConvergenceException);
  });

  test('base conversions', () => {
    // scaddins/qa/analysis.cxx test_getDec2Hex: 'Places' accepts numeric types
    expect(a.getDec2Hex(undefined, 110, 10)).toBe('000000006E');
    expect(a.getDec2Bin(xOpt, 9, 4)).toBe('1001');
    expect(a.getDec2Bin(xOpt, -100, undefined)).toBe('1110011100');
    expect(a.getDec2Hex(xOpt, 100, 4)).toBe('0064');
    expect(a.getDec2Hex(xOpt, -54, undefined)).toBe('FFFFFFFFCA');
    expect(a.getDec2Oct(xOpt, -100, undefined)).toBe('7777777634');
    expect(a.getHex2Dec('FFFFFFFF5B')).toBe(-165);
    expect(a.getHex2Dec('a5')).toBe(165);
    expect(a.getBin2Dec('1111111111')).toBe(-1);
    expect(a.getBin2Hex(xOpt, '11111011', 4)).toBe('00FB');
    expect(a.getOct2Bin(xOpt, '3', 3)).toBe('011');
    expect(a.getOct2Dec('7777777533')).toBe(-165);
    expect(a.getHex2Oct(xOpt, 'F', 3)).toBe('017');
    expect(a.getHex2Bin(xOpt, 'FFFFFFFFFF', undefined)).toBe('1111111111');
    expect(() => a.getDec2Bin(xOpt, 512, undefined)).toThrow(IllegalArgumentException);
    expect(() => a.getDec2Bin(xOpt, 9, 3)).toThrow(IllegalArgumentException);
    expect(() => a.getBin2Dec('12')).toThrow(IllegalArgumentException);
    expect(() => a.getHex2Dec('12345678901')).toThrow(IllegalArgumentException);
  });

  test('complex numbers', () => {
    expect(a.getComplex(3, 4, undefined)).toBe('3+4i');
    expect(a.getComplex(3, 4, 'j')).toBe('3+4j');
    expect(a.getComplex(0, 1, undefined)).toBe('i');
    expect(a.getComplex(0, -1, '')).toBe('-i');
    expect(a.getComplex(1, 0, undefined)).toBe('1');
    expect(() => a.getComplex(1, 1, 'k')).toThrow(IllegalArgumentException);
    expect(a.getImabs('5+12i')).toBe(13);
    expect(a.getImsum(xOpt, [['3+4i']], ['5-3i'])).toBe('8+i');
    expect(a.getImsub('13+4i', '5+3i')).toBe('8+i');
    expect(a.getImproduct(xOpt, [['3+4i', '5-3i']], [])).toBe('27+11i');
    expect(a.getImproduct(xOpt, [['1+2i']], [30, [['2']]])).toBe('60+120i');
    expect(a.getImdiv('-238+240i', '10+24i')).toBe('5+12i');
    expect(() => a.getImdiv('1', '0')).toThrow(IllegalArgumentException);
    expect(a.getImsqrt('-4')).toBe('2i');
    expect(a.getImconjugate('3+4i')).toBe('3-4i');
    expect(a.getImreal('6-9i')).toBe(6);
    expect(a.getImaginary('3+4i')).toBe(4);
    expect(a.getImargument('3+4i')).toBeCloseTo(0.927295218001612, 14);
    expect(() => a.getImargument('0')).toThrow(IllegalArgumentException);
    expect(a.getImexp('1+i')).toBe('1.46869393991589+2.28735528717884i');
    expect(a.getImln('3+4i')).toBe('1.6094379124341+0.927295218001612i');
    expect(a.getImlog10('3+4i')).toBe('0.698970004336019+0.402719196273373i');
    expect(a.getImsin('3+4i')).toBe('3.85373803791938-27.0168132580039i');
    expect(a.getImcos('1+i')).toBe('0.833730025131149-0.988897705762865i');
    const p = new Complex(a.getImpower('2+3i', 3));
    expect(p.Real()).toBeCloseTo(-46, 12);
    expect(p.Imag()).toBeCloseTo(9, 12);
  });

  test('CONVERT', () => {
    expect(a.getConvert(68, 'F', 'C')).toBeCloseTo(20, 12);
    expect(() => a.getConvert(1, 'm', 'g')).toThrow(IllegalArgumentException);
  });

  test('financial functions', () => {
    expect(a.getEffect(0.0525, 4)).toBeCloseTo(0.0535426673707584, 15);
    expect(a.getNominal(0.053543, 4)).toBeCloseTo(0.05250032, 8);
    expect(a.getDollarde(1.02, 16)).toBeCloseTo(1.125, 14);
    expect(a.getDollarfr(1.125, 16)).toBeCloseTo(1.02, 14);
    expect(a.getAccrintm(xOpt, D(2008, 4, 1), D(2008, 6, 15), 0.1, 1000, 3)).toBeCloseTo(20.5479452, 6);
    expect(a.getAccrint(xOpt, D(2008, 3, 1), D(2008, 8, 31), D(2008, 5, 1), 0.1, 1000, 2, 0)).toBeCloseTo(16.6666667, 6);
    expect(a.getDisc(xOpt, D(2007, 1, 25), D(2007, 6, 15), 97.975, 100, 1)).toBeCloseTo(0.052420213, 8);
    expect(a.getPrice(xOpt, D(2008, 2, 15), D(2017, 11, 15), 0.0575, 0.065, 100, 2, 0)).toBeCloseTo(94.6343616, 6);
    expect(a.getYield(xOpt, D(2008, 2, 15), D(2016, 11, 15), 0.0575, 95.04287, 100, 2, 0)).toBeCloseTo(0.065, 6);
    expect(a.getCoupdays(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(181);
    expect(a.getCoupdaybs(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(71);
    expect(a.getCoupdaysnc(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(110);
    expect(a.getCoupncd(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(D(2011, 5, 15));
    expect(a.getCouppcd(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(D(2010, 11, 15));
    expect(a.getCoupnum(xOpt, D(2011, 1, 25), D(2011, 11, 15), 2, 1)).toBe(2);
    expect(() => a.getCoupnum(xOpt, D(2011, 1, 25), D(2011, 11, 15), 3, 1)).toThrow(IllegalArgumentException);
    const v = [[-10000], [2750], [4250], [3250], [2750]];
    const d = [[D(2008, 1, 1)], [D(2008, 3, 1)], [D(2008, 10, 30)], [D(2009, 2, 15)], [D(2009, 4, 1)]];
    expect(a.getXnpv(0.09, v, d)).toBeCloseTo(2086.647602, 5);
    expect(a.getXirr(xOpt, v, d, undefined)).toBeCloseTo(0.373362535, 8);
    expect(() => a.getXirr(xOpt, [[1]], [[1]], undefined)).toThrow(IllegalArgumentException);
    // LibreOffice's DURATION differs from Excel's (5.993775) here
    const fDur = a.getDuration(xOpt, D(2008, 1, 1), D(2016, 1, 1), 0.08, 0.09, 2, 1);
    expect(fDur).toBeCloseTo(5.99195014, 7);
    expect(a.getMduration(xOpt, D(2008, 1, 1), D(2016, 1, 1), 0.08, 0.09, 2, 1)).toBeCloseTo(fDur / 1.045, 14);
    expect(a.getCumipmt(0.09 / 12, 360, 125000, 13, 24, 0)).toBeCloseTo(-11135.23213, 4);
    expect(a.getCumprinc(0.09 / 12, 360, 125000, 13, 24, 0)).toBeCloseTo(-934.1071234, 6);
    expect(a.getFvschedule(1, [[0.09, 0.11, 0.1]])).toBeCloseTo(1.33089, 12);
    expect(a.getTbillprice(xOpt, D(2008, 3, 31), D(2008, 6, 1), 0.09)).toBeCloseTo(98.45, 10);
    expect(a.getTbilleq(xOpt, D(2008, 3, 31), D(2008, 6, 1), 0.0914)).toBeCloseTo(0.094151494, 8);
    expect(a.getTbillyield(xOpt, D(2008, 3, 31), D(2008, 6, 1), 98.45)).toBeCloseTo(0.091417, 6);
    expect(a.getAmordegrc(xOpt, 2400, D(2008, 8, 19), D(2008, 12, 31), 300, 1, 0.15, 1)).toBe(776);
    expect(a.getAmorlinc(xOpt, 2400, D(2008, 8, 19), D(2008, 12, 31), 300, 1, 0.15, 1)).toBe(360);
    expect(a.getPricedisc(xOpt, D(2008, 2, 16), D(2008, 3, 1), 0.0525, 100, 2)).toBeCloseTo(99.79583333, 8);
    expect(a.getPricemat(xOpt, D(2008, 2, 15), D(2008, 4, 13), D(2007, 11, 11), 0.061, 0.061, 0)).toBeCloseTo(99.98449888, 8);
    expect(a.getYielddisc(xOpt, D(2008, 2, 16), D(2008, 3, 1), 99.795, 100, 2)).toBeCloseTo(0.052823, 6);
    expect(a.getYieldmat(xOpt, D(2008, 3, 15), D(2008, 11, 3), D(2007, 11, 8), 0.0625, 100.0123, 0)).toBeCloseTo(0.060954, 6);
    expect(a.getReceived(xOpt, D(2008, 2, 15), D(2008, 5, 15), 1000000, 0.0575, 2)).toBeCloseTo(1014584.654, 3);
    expect(a.getIntrate(xOpt, D(2008, 2, 15), D(2008, 5, 15), 1000000, 1014420, 2)).toBeCloseTo(0.05768, 5);
    expect(a.getOddlprice(xOpt, D(2008, 2, 7), D(2008, 6, 15), D(2007, 10, 15), 0.0375, 0.0405, 100, 2, 0)).toBeCloseTo(99.87828601, 8);
    expect(a.getOddlyield(xOpt, D(2008, 4, 20), D(2008, 6, 15), D(2007, 12, 24), 0.0375, 99.875, 100, 2, 0)).toBeCloseTo(0.045192, 6);
    // ODDFPRICE and ODDFYIELD are not implemented upstream either
    expect(() => a.getOddfprice(xOpt, D(2008, 11, 11), D(2021, 3, 1), D(2008, 10, 15), D(2009, 3, 1), 0.0785, 0.0625, 100, 2, 1)).toThrow(RuntimeException);
  });
});

describe('the component', () => {
  test('describes its functions as the add-in collection reads them', () => {
    expect(a.getServiceName()).toBe('com.sun.star.sheet.addin.Analysis');
    const m = a.getMethods();
    expect(m.length).toBe(101);
    const ed = m.find((x) => x.getName() === 'getEdate')!;
    expect(ed.getParameterInfos().map((p) => p.aName)).toEqual(['xOptions', 'nStartDate', 'nNumOfMonths']);
    expect(ed.invoke([xOpt, D(2011, 1, 31), 1])).toBe(D(2011, 2, 28));
    // an omitted argument cannot become a long
    expect(() => ed.invoke([xOpt, D(2011, 1, 31), undefined])).toThrow(IllegalArgumentException);
    expect(a.getDisplayFunctionName('getEdate')).toBe('EDATE');
    expect(a.getDisplayFunctionName('getWeeknum')).toBe('WEEKNUM_EXCEL2003');
    expect(a.getDisplayFunctionName('getIseven')).toBe('ISEVEN_ADD');
    expect(a.getFunctionDescription('getEdate')).toMatch(/^Returns the serial number of the date/);
    expect(a.getDisplayArgumentName('getEdate', 0)).toBe('internal');
    expect(a.getDisplayArgumentName('getEdate', 1)).toBe('Start date');
    expect(a.getArgumentDescription('getEdate', 2)).toBe('Number of months before or after the start date');
    expect(a.getDisplayArgumentName('getIseven', 0)).toBe('Number');
    expect(a.getProgrammaticCategoryName('getEdate')).toBe('Date&Time');
    expect(a.getProgrammaticCategoryName('getConvert')).toBe('Technical');
    expect(a.getCompatibilityNames('getEdate')).toEqual([
      { Locale: { Language: 'de', Country: 'DE' }, Name: 'EDATUM' },
      { Locale: { Language: 'en', Country: 'US' }, Name: 'EDATE' },
    ]);
  });
});

describe('through formulas', () => {
  test('date, math and engineering functions', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=DATE(2008;11;26)', A2: '=DATE(2008;12;4)', A3: '=DATE(2009;1;21)' });
    expect(calcValue(doc, '=EDATE(DATE(2011;1;31);1)')).toBe(40602);
    expect(calcValue(doc, '=EOMONTH(DATE(2011;1;1);-3)')).toBe(D(2010, 10, 31));
    expect(calcValue(doc, '=WORKDAY(DATE(2008;10;1);151;A1:A3)')).toBe(D(2009, 5, 5));
    expect(calcValue(doc, '=NETWORKDAYS(DATE(2012;10;1);DATE(2013;3;1);DATE(2012;11;22))')).toBe(109);
    expect(calcValue(doc, '=YEARFRAC(DATE(2012;1;1);DATE(2012;7;30))')).toBeCloseTo(0.580555556, 8);
    expect(calcValue(doc, '=GCD(24;36)')).toBe(12);
    expect(calcValue(doc, '=MULTINOMIAL(2;3;4)')).toBe(1260);
    expect(calcValue(doc, '=MROUND(10;3)')).toBe(9);
    expect(calcValue(doc, '=QUOTIENT(-10;3)')).toBe(-3);
    expect(calc(doc, '=DEC2HEX(100;4)')).toBe('0064');
    expect(calc(doc, '=DEC2BIN(512)')).toBe('Err:502');
    expect(calc(doc, '=COMPLEX(3;4)')).toBe('3+4i');
    expect(calc(doc, '=IMSUM("3+4i";"5-3i")')).toBe('8+i');
    expect(calcValue(doc, '=CONVERT(68;"F";"C")')).toBeCloseTo(20, 12);
    expect(calcValue(doc, '=FACTDOUBLE(6)')).toBe(48);
    expect(calcValue(doc, '=DELTA(5;5)')).toBe(1);
  });

  test('financial functions', () => {
    const doc = newDoc();
    putAll(doc, { A1: -10000, A2: 2750, A3: 4250, A4: 3250, A5: 2750, B1: '=DATE(2008;1;1)', B2: '=DATE(2008;3;1)', B3: '=DATE(2008;10;30)', B4: '=DATE(2009;2;15)', B5: '=DATE(2009;4;1)' });
    expect(calcValue(doc, '=XNPV(0.09;A1:A5;B1:B5)')).toBeCloseTo(2086.647602, 5);
    expect(calcValue(doc, '=XIRR(A1:A5;B1:B5)')).toBeCloseTo(0.373362535, 8);
    expect(calcValue(doc, '=PRICE(DATE(2008;2;15);DATE(2017;11;15);0.0575;0.065;100;2;0)')).toBeCloseTo(94.6343616, 6);
    expect(calcValue(doc, '=COUPDAYS(DATE(2011;1;25);DATE(2011;11;15);2;1)')).toBe(181);
    expect(calc(doc, '=TBILLEQ(DATE(1999;3;31);;0.0914)')).toBe('Err:502');
    expect(calc(doc, '=COUPNUM(DATE(2011;1;25);DATE(2011;11;15);3;1)')).toBe('Err:502');
  });
});
