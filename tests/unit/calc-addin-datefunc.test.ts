// The DateFunctions add-in (scaddins/source/datefunc): its methods called directly, the component
// surface the add-in collection reads, and the functions through formulas.
import { describe, expect, test } from 'vitest';
import { IllegalArgumentException, RuntimeException, type XPropertySet } from '../../src/lo/sc/inc/addincol.ts';
import { ScaDateAddIn } from '../../src/lo/scaddins/source/datefunc/datefunc.ts';
import { calc, calcValue, newDoc } from './calchelper.ts';

const xOpt: XPropertySet = { getPropertyValue: (s: string) => (s === 'NullDate' ? { Day: 30, Month: 12, Year: 1899 } : undefined) };
const a = new ScaDateAddIn();
a.setLocale({ Language: 'en', Country: 'US' });
// serial numbers of dates (null date 1899-12-30)
const D = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

describe('ScaDateAddIn methods', () => {
  test('WEEKS', () => {
    expect(a.getDiffWeeks(xOpt, D(2010, 1, 1), D(2010, 12, 31), 0)).toBe(52);
    expect(a.getDiffWeeks(xOpt, D(2010, 1, 1), D(2010, 1, 7), 0)).toBe(0);
    // calendar weeks start on Monday: Sunday 2010-01-03 to Monday 2010-01-04 is one week
    expect(a.getDiffWeeks(xOpt, D(2010, 1, 3), D(2010, 1, 4), 1)).toBe(1);
    expect(a.getDiffWeeks(xOpt, D(2010, 1, 4), D(2010, 1, 3), 1)).toBe(-1);
    expect(() => a.getDiffWeeks(xOpt, 1, 2, 2)).toThrow(IllegalArgumentException);
  });

  test('MONTHS and YEARS', () => {
    expect(a.getDiffMonths(xOpt, D(2010, 1, 31), D(2010, 2, 28), 0)).toBe(0);
    expect(a.getDiffMonths(xOpt, D(2010, 1, 31), D(2010, 2, 28), 1)).toBe(1);
    expect(a.getDiffMonths(xOpt, D(2010, 3, 15), D(2010, 1, 20), 0)).toBe(-1);
    expect(a.getDiffYears(xOpt, D(2009, 12, 31), D(2010, 1, 1), 0)).toBe(0);
    expect(a.getDiffYears(xOpt, D(2009, 12, 31), D(2010, 1, 1), 1)).toBe(1);
    expect(a.getDiffYears(xOpt, D(2000, 2, 29), D(2010, 2, 28), 0)).toBe(9);
    expect(() => a.getDiffMonths(xOpt, 1, 2, -1)).toThrow(IllegalArgumentException);
  });

  test('ISLEAPYEAR, DAYSINMONTH, DAYSINYEAR, WEEKSINYEAR', () => {
    expect(a.getIsLeapYear(xOpt, D(2000, 2, 29))).toBe(1);
    expect(a.getIsLeapYear(xOpt, D(1900, 6, 1))).toBe(0);
    expect(a.getDaysInMonth(xOpt, D(2004, 2, 1))).toBe(29);
    expect(a.getDaysInMonth(xOpt, D(2003, 2, 1))).toBe(28);
    expect(a.getDaysInYear(xOpt, D(2004, 7, 1))).toBe(366);
    expect(a.getWeeksInYear(xOpt, D(2015, 6, 1))).toBe(53); // starts on a Thursday
    expect(a.getWeeksInYear(xOpt, D(2016, 6, 1))).toBe(52);
    expect(a.getWeeksInYear(xOpt, D(2020, 6, 1))).toBe(53); // leap year starting on a Wednesday
    expect(() => a.getIsLeapYear(undefined, 1)).toThrow(RuntimeException);
  });

  test('ROT13', () => {
    expect(a.getRot13('Hello, World!')).toBe('Uryyb, Jbeyq!');
    expect(a.getRot13(a.getRot13('Zebra äöü'))).toBe('Zebra äöü');
  });
});

describe('the component', () => {
  test('describes its functions as the add-in collection reads them', () => {
    expect(a.getServiceName()).toBe('com.sun.star.sheet.addin.DateFunctions');
    const m = a.getMethods();
    expect(m.map((x) => x.getName())).toEqual(['getDiffWeeks', 'getDiffMonths', 'getDiffYears', 'getIsLeapYear', 'getDaysInMonth', 'getDaysInYear', 'getWeeksInYear', 'getRot13']);
    expect(m.find((x) => x.getName() === 'getRot13')!.invoke(['abc'])).toBe('nop');
    expect(a.getDisplayFunctionName('getDiffWeeks')).toBe('WEEKS');
    expect(a.getDisplayArgumentName('getDiffWeeks', 0)).toBe('internal');
    expect(a.getDisplayArgumentName('getDiffWeeks', 3)).toBe('Type');
    expect(a.getDisplayArgumentName('getRot13', 0)).toBe('Text');
    expect(a.getFunctionDescription('getRot13')).toBe('Encrypts or decrypts a text using the ROT13 algorithm');
    expect(a.getProgrammaticCategoryName('getRot13')).toBe('Text');
    expect(a.getProgrammaticCategoryName('getIsLeapYear')).toBe('Date&Time');
    expect(a.getCompatibilityNames('getIsLeapYear').map((n) => n.Name)).toEqual(['ISTSCHALTJAHR', 'ISLEAPYEAR']);
  });
});

describe('through formulas', () => {
  test('the date functions and ROT13', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=WEEKS(DATE(2010;1;1);DATE(2010;12;31);0)')).toBe(52);
    expect(calcValue(doc, '=MONTHS(DATE(2010;1;31);DATE(2010;2;28);1)')).toBe(1);
    expect(calcValue(doc, '=YEARS(DATE(2009;12;31);DATE(2010;1;1);1)')).toBe(1);
    expect(calcValue(doc, '=DAYSINMONTH(DATE(2004;2;1))')).toBe(29);
    expect(calcValue(doc, '=DAYSINYEAR(DATE(2004;2;1))')).toBe(366);
    expect(calcValue(doc, '=WEEKSINYEAR(DATE(2015;1;1))')).toBe(53);
    expect(calc(doc, '=ROT13("Hello")')).toBe('Uryyb');
    expect(calc(doc, '=WEEKS(1;2;3)')).toBe('Err:502');
  });
});
