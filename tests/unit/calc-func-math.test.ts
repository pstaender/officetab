// Math, trigonometry and rounding functions (interpr1.cxx, interpr2.cxx, interpr5.cxx ports).
import { describe, expect, it } from 'vitest';
import { calc, calcValue, newDoc, putAll } from './calchelper.ts';
import { MATH_CASES } from './calc-func-math.cases.ts';

describe('Calc math functions: upstream test sheets', () => {
  // The self-contained formulas of sc/qa/unit/data/functions/{mathematical,text,array}/fods/*.fods
  // (Sheet2, first column) with the result LibreOffice stored for them.
  for (const [sheet, f, exp] of MATH_CASES) {
    it(`${sheet}: ${f}`, () => {
      const doc = newDoc();
      if (typeof exp === 'number') {
        expect(calc(doc, f)).not.toMatch(/^(Err:|#)/);
        const v = calcValue(doc, f);
        expect(Math.abs(v - exp)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(exp)));
      } else expect(calc(doc, f)).toBe(exp);
    });
  }
});

describe('Calc math functions', () => {
  it('computes trigonometry', () => {
    const doc = newDoc();
    expect(calc(doc, '=PI()')).toBe('3.14159265358979');
    expect(calcValue(doc, '=SIN(PI()/2)')).toBe(1);
    expect(calcValue(doc, '=COS(0)')).toBe(1);
    expect(calcValue(doc, '=DEGREES(PI())')).toBe(180);
    expect(calcValue(doc, '=RADIANS(90)')).toBe(Math.PI / 2);
    expect(calc(doc, '=SIN(1E20)')).toBe('#VALUE!');
    expect(calc(doc, '=ASIN(2)')).toBe('#NUM!');
    expect(calc(doc, '=ATANH(1)')).toBe('Err:502');
    expect(calc(doc, '=COT(0)')).toBe('#NUM!');
    expect(calcValue(doc, '=ASINH(SINH(0.5))')).toBeCloseTo(0.5, 14);
    expect(calcValue(doc, '=ACOSH(1.05)')).toBeCloseTo(Math.acosh(1.05), 14);
    expect(calcValue(doc, '=ATAN2(1;1)')).toBeCloseTo(Math.PI / 4, 15);
  });

  it('computes logarithms and roots', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=LOG(8;2)')).toBeCloseTo(3, 14);
    expect(calcValue(doc, '=LOG(1000)')).toBeCloseTo(3, 14);
    expect(calc(doc, '=LOG(8;1)')).toBe('Err:502');
    expect(calc(doc, '=LN(0)')).toBe('Err:502');
    expect(calc(doc, '=SQRT(-1)')).toBe('Err:502');
    expect(calcValue(doc, '=EXP(1)')).toBeCloseTo(Math.E, 15);
  });

  it('rounds', () => {
    const doc = newDoc();
    expect(calc(doc, '=ROUNDUP(8.06-8;2)')).toBe('0.06');
    expect(calc(doc, '=ROUNDDOWN(2-5E-015;13)')).toBe('1.9999999999999');
    expect(calc(doc, '=TRUNC(-2.7)')).toBe('-2');
    expect(calc(doc, '=INT(-2.5)')).toBe('-3');
    expect(calc(doc, '=ROUNDSIG(123.456;2)')).toBe('120');
    expect(calc(doc, '=MOD(-1;3)')).toBe('2');
    expect(calc(doc, '=MOD(1;0)')).toBe('#DIV/0!');
    expect(calc(doc, '=EVEN(-1.5)')).toBe('-2');
    expect(calc(doc, '=ODD(2)')).toBe('3');
    expect(calc(doc, '=SIGN(-3)')).toBe('-1');
    expect(calc(doc, '=CEILING(-2.5;2)')).toBe('Err:502');
    expect(calc(doc, '=CEILING(-2.5;-2)')).toBe('-2');
    expect(calc(doc, '=CEILING(-2.5;2;1)')).toBe('Err:502');
    expect(calc(doc, '=CEILING(-2.5;-2;1)')).toBe('-4');
    expect(calc(doc, '=CEILING.MATH(-2.5;2)')).toBe('-2');
    expect(calc(doc, '=FLOOR(-2.5;;1)')).toBe('-2');
    expect(calc(doc, '=FLOOR.XCL(2.5;0)')).toBe('Err:502');
  });

  it('operates on bits', () => {
    const doc = newDoc();
    expect(calc(doc, '=BITAND(12;10)')).toBe('8');
    expect(calc(doc, '=BITOR(12;10)')).toBe('14');
    expect(calc(doc, '=BITXOR(12;10)')).toBe('6');
    expect(calc(doc, '=BITLSHIFT(1;40)')).toBe('1099511627776');
    expect(calc(doc, '=BITRSHIFT(16;-2)')).toBe('64');
    expect(calc(doc, '=BITAND(2^48;1)')).toBe('Err:502');
  });

  it('converts numbers', () => {
    const doc = newDoc();
    expect(calc(doc, '=BASE(255;16)')).toBe('FF');
    expect(calc(doc, '=BASE(5;2;8)')).toBe('00000101');
    expect(calc(doc, '=BASE(0;2)')).toBe('0');
    expect(calc(doc, '=BASE(2^60;36)')).toBe('8RC4KBDVSS1S');
    expect(calc(doc, '=DECIMAL("FF";16)')).toBe('255');
    expect(calc(doc, '=DECIMAL("0x1F";16)')).toBe('31');
    expect(calc(doc, '=DECIMAL("101b";2)')).toBe('5');
    expect(calc(doc, '=DECIMAL("12";2)')).toBe('Err:502');
    expect(calc(doc, '=ROMAN(1999)')).toBe('MCMXCIX');
    expect(calc(doc, '=ROMAN(1999;4)')).toBe('MIM');
    expect(calc(doc, '=ROMAN(4000)')).toBe('Err:502');
    expect(calc(doc, '=ARABIC("mcmxcix")')).toBe('1999');
    expect(calc(doc, '=ARABIC("MIM")')).toBe('1999');
    expect(calc(doc, '=ARABIC("IIII")')).toBe('4');
    expect(calc(doc, '=ARABIC("IIIII")')).toBe('Err:502');
    expect(calc(doc, '=CONVERT_OOO(100;"EUR";"DEM")')).toBe('195.583');
    expect(calcValue(doc, '=CONVERT_OOO(195.583;"DEM";"EUR")')).toBeCloseTo(100, 12);
    expect(calc(doc, '=CONVERT_OOO(1;"EUR";"USD")')).toBe('#N/A');
    expect(calc(doc, '=EUROCONVERT(1;"FRF";"DEM")')).toBe('0.3');
    expect(calcValue(doc, '=EUROCONVERT(1;"FRF";"DEM";1)')).toBeCloseTo(1.95583 / 6.55957, 14);
    expect(calc(doc, '=EUROCONVERT(1;"FRF";"DEM";1;3)')).toBe('0.29728616');
  });

  it('computes GCD and LCM over values, ranges and arrays', () => {
    const doc = newDoc();
    putAll(doc, { A1: 12, A2: 18, A3: 'x', A4: 30 });
    expect(calc(doc, '=GCD(A1:A4)')).toBe('6');
    expect(calc(doc, '=GCD(A1:A4;4)')).toBe('2');
    expect(calc(doc, '=LCM(A1:A2;5)')).toBe('180');
    expect(calc(doc, '=GCD({12,18,24})')).toBe('6');
    expect(calc(doc, '=LCM({2,3,4})')).toBe('12');
    expect(calc(doc, '=GCD(-2;4)')).toBe('Err:502');
    expect(calc(doc, '=GCD({-2,4})')).toBe('Err:502');
    expect(calc(doc, '=LCM(0;4)')).toBe('0');
  });

  it('computes SUMX2MY2, SUMX2PY2 and SUMXMY2', () => {
    const doc = newDoc();
    putAll(doc, { A1: 1, A2: 2, A3: 3, B1: 4, B2: 'x', B3: 6 });
    expect(calc(doc, '=SUMX2MY2(A1:A3;B1:B3)')).toBe('-42');
    expect(calc(doc, '=SUMX2PY2(A1:A3;B1:B3)')).toBe('62');
    expect(calc(doc, '=SUMXMY2({1,2,3};{4,5,6})')).toBe('27');
    expect(calc(doc, '=SUMXMY2(A1:A3;B1:B2)')).toBe('#VALUE!');
  });

  it('draws random numbers', () => {
    const doc = newDoc();
    for (let i = 0; i < 20; i++) {
      const r = calcValue(doc, '=RAND()');
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      const n = calcValue(doc, '=RANDBETWEEN.NV(-2;2)');
      expect(Number.isInteger(n) && n >= -2 && n <= 2).toBe(true);
      const w = calcValue(doc, '=RANDARRAY(1;1;5;6;1)');
      expect(w === 5 || w === 6).toBe(true);
    }
    expect(calc(doc, '=RANDBETWEEN.NV(3;2)')).toBe('Err:502');
    expect(calc(doc, '=RANDARRAY(0)')).toBe('Err:502');
    expect(calcValue(doc, '=SUM(RANDARRAY(3;2;1;1))')).toBeCloseTo(6, 12);
  });
});
