// Date and time functions (interpr2.cxx port). Expected values from LibreOffice's test sheets
// sc/qa/unit/data/functions/date_time/fods/*.fods unless noted.
import { describe, expect, it } from 'vitest';
import { Date as ToolsDate, DateDiff } from '../../src/lo/tools/source/datetime/tdate.ts';
import { Time } from '../../src/lo/tools/source/datetime/ttime.ts';
import { calc, calcValue, newDoc, putAll, str, val } from './calchelper.ts';

/** The serial number of a date with the default null date 1899-12-30. */
const serial = (y: number, m: number, d: number) => DateDiff(new ToolsDate(d, m, y), new ToolsDate(30, 12, 1899));

describe('tools Date', () => {
  it('converts days and dates', () => {
    expect(serial(1899, 12, 30)).toBe(0);
    expect(serial(1900, 1, 1)).toBe(2);
    expect(serial(2000, 1, 1)).toBe(36526);
    const d = new ToolsDate(30, 12, 1899);
    d.AddDays(36526);
    expect([d.GetYear(), d.GetMonth(), d.GetDay()]).toEqual([2000, 1, 1]);
    d.AddDays(-36527);
    expect([d.GetYear(), d.GetMonth(), d.GetDay()]).toEqual([1899, 12, 29]);
    expect(new ToolsDate(1, 1, 2024).GetDayOfWeek()).toBe(0); // Monday
    expect(new ToolsDate(29, 2, 2024).IsValidAndGregorian()).toBe(true);
    expect(new ToolsDate(29, 2, 2023).IsValidAndGregorian()).toBe(false);
    expect(new ToolsDate(4, 10, 1582).IsValidAndGregorian()).toBe(false);
    const n = new ToolsDate(31, 2, 2023);
    n.Normalize();
    expect([n.GetYear(), n.GetMonth(), n.GetDay()]).toEqual([2023, 3, 3]);
  });

  it('numbers weeks', () => {
    // ISO 8601
    expect(new ToolsDate(1, 1, 2021).GetWeekOfYear()).toBe(53);
    expect(new ToolsDate(4, 1, 2021).GetWeekOfYear()).toBe(1);
    expect(new ToolsDate(31, 12, 2024).GetWeekOfYear()).toBe(1);
    expect(new ToolsDate(28, 12, 2020).GetWeekOfYear()).toBe(53);
  });

  it('splits a time of day', () => {
    expect(Time.GetClock(0.5, 0)).toMatchObject({ nHour: 12, nMinute: 0, nSecond: 0 });
    expect(Time.GetClock(1 - 1e-16, 0)).toMatchObject({ nHour: 0, nMinute: 0, nSecond: 0 });
    expect(Time.GetClock(45000 + (23 * 3600 + 59 * 60 + 59) / 86400, 0)).toMatchObject({ nHour: 23, nMinute: 59, nSecond: 59 });
  });
});

describe('Calc date functions', () => {
  it('computes DATE', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=DATE(1983;1;31)')).toBe(serial(1983, 1, 31));
    expect(calc(doc, '=DATE(1983;1;31)')).toBe('1/31/83');
    expect(calcValue(doc, '=DATE(0;12;31)')).toBe(serial(2000, 12, 31));
    expect(calcValue(doc, '=DATE(0;13;31)')).toBe(serial(2001, 1, 31));
    expect(calcValue(doc, '=DATE(0;0;0)')).toBe(serial(1999, 11, 30));
    expect(calcValue(doc, '=DATE(1;10;1)')).toBe(serial(2001, 10, 1));
    expect(calcValue(doc, '=DATE(10;1;1)')).toBe(serial(2010, 1, 1));
    expect(calcValue(doc, '=DATE(29;1;1)')).toBe(serial(2029, 1, 1));
    expect(calcValue(doc, '=DATE(30;1;1)')).toBe(serial(1930, 1, 1));
    expect(calc(doc, '=DATE(100;1;1)')).toBe('#VALUE!');
    expect(calc(doc, '=DATE(1000;1;1)')).toBe('#VALUE!');
    expect(calcValue(doc, '=DATE(1899;1;1)')).toBe(serial(1899, 1, 1));
    expect(calcValue(doc, '=DATE(1900;1;1)')).toBe(2);
    expect(calcValue(doc, '=DATE(2024;2;30)')).toBe(serial(2024, 3, 1));
    expect(calcValue(doc, '=DATE(2024;-1;1)')).toBe(serial(2023, 11, 1));
    expect(calc(doc, '=DATE(-1;1;1)')).toBe('Err:502');
  });

  it('computes YEAR, MONTH, DAY', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=YEAR(1)')).toBe(1899);
    expect(calcValue(doc, '=YEAR(2)')).toBe(1900);
    expect(calcValue(doc, '=YEAR(0)')).toBe(1899);
    expect(calcValue(doc, '=YEAR(-1)')).toBe(1899);
    expect(calcValue(doc, '=MONTH(1)')).toBe(12);
    expect(calcValue(doc, '=MONTH(0)')).toBe(12);
    expect(calcValue(doc, '=DAY(DATE(2024;2;29))')).toBe(29);
    expect(calcValue(doc, '=MONTH(DATE(2024;2;29))')).toBe(2);
    expect(calcValue(doc, '=YEAR(DATE(2024;2;29)+0.99)')).toBe(2024);
    expect(calcValue(doc, '=DAY("1899-12-29T15:26:14")') || calcValue(doc, '=DAY(-0.5)')).toBe(29);
    expect(calcValue(doc, '=YEAR("2015-06-01")')).toBe(2015);
  });

  it('computes HOUR, MINUTE, SECOND', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=HOUR("17:20:00")')).toBe(17);
    expect(calcValue(doc, '=MINUTE("17:20:00")')).toBe(20);
    expect(calcValue(doc, '=MINUTE(1)')).toBe(0);
    expect(calcValue(doc, '=SECOND(0)')).toBe(0);
    expect(calcValue(doc, '=HOUR(0.75)')).toBe(18);
    expect(calcValue(doc, '=SECOND(TIME(1;2;3))')).toBe(3);
    expect(calcValue(doc, '=MINUTE(TIME(1;2;3))')).toBe(2);
    // The fraction of a second rounds the second (and only the second).
    expect(calcValue(doc, '=SECOND((59.6)/86400)')).toBe(0);
    expect(calcValue(doc, '=MINUTE((59.6)/86400)')).toBe(0);
    expect(calcValue(doc, '=SECOND((10.5)/86400)')).toBe(11);
    expect(calcValue(doc, '=HOUR(45000.9999999)')).toBe(23);
  });

  it('computes TIME', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=TIME(11;19;19)')).toBeCloseTo((11 * 3600 + 19 * 60 + 19) / 86400, 14);
    expect(calc(doc, '=TIME(11;19;19)')).toBe('11:19:19');
    expect(calc(doc, '=TIME(-1;0;0)')).toBe('Err:502');
    expect(calcValue(doc, '=TIME(0;0;0)')).toBe(0);
    expect(calcValue(doc, '=TIME(24;60;1)')).toBeCloseTo(3601 / 86400, 14);
    expect(calcValue(doc, '=TIME(24;60;-1)')).toBeCloseTo(3599 / 86400, 14);
    expect(calcValue(doc, '=TIME(23;60;0)')).toBe(0);
    expect(calcValue(doc, '=TIME(24;0;0)')).toBe(0);
  });

  it('computes DATEVALUE and TIMEVALUE as numbers', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=DATEVALUE("1954-07-20")')).toBe(19925);
    expect(calc(doc, '=DATEVALUE("1954-07-20")')).toBe('19925');
    expect(calcValue(doc, '=DATEVALUE("7/20/1954")')).toBe(19925);
    expect(calc(doc, '=DATEVALUE("Jan1, 2015")')).toBe('Err:502');
    expect(calc(doc, '=DATEVALUE("12:00")')).toBe('Err:502');
    expect(calcValue(doc, '=TIMEVALUE("12:00am")')).toBe(0);
    expect(calcValue(doc, '=TIMEVALUE("12:00 PM")')).toBe(0.5);
    expect(calcValue(doc, '=TIMEVALUE("4:00 PM")')).toBeCloseTo(0.666666666666667, 14);
    expect(calcValue(doc, '=TIMEVALUE("16:48:30")')).toBeCloseTo((16 * 3600 + 48 * 60 + 30) / 86400, 14);
    expect(calc(doc, '=TIMEVALUE("16:48")')).toBe('0.7');
    expect(calc(doc, '=TIMEVALUE("1954-07-20")')).toBe('Err:502');
    // Within an expression the result is a time.
    expect(calc(doc, '=TIMEVALUE("16:48")+0')).toBe('16:48:00');
  });

  it('computes TODAY and NOW from the calculation time', () => {
    const doc = newDoc();
    doc.SetCalcNow(new globalThis.Date(2020, 0, 15, 18, 30, 0));
    expect(calcValue(doc, '=TODAY()')).toBe(serial(2020, 1, 15));
    expect(calc(doc, '=TODAY()')).toBe('1/15/20');
    expect(calcValue(doc, '=NOW()')).toBeCloseTo(serial(2020, 1, 15) + 0.7708333333333334, 10);
    expect(calc(doc, '=NOW()')).toBe('1/15/20 18:30');
  });

  it('computes WEEKDAY', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=WEEKDAY("2000-06-14")')).toBe(4);
    expect(calcValue(doc, '=WEEKDAY("1996-07-24";2)')).toBe(3);
    expect(calcValue(doc, '=WEEKDAY("2016-07-24";1)')).toBe(1);
    expect(calcValue(doc, '=WEEKDAY("2016-07-24";2)')).toBe(7);
    expect(calcValue(doc, '=WEEKDAY("2016-07-24";3)')).toBe(6);
    const flags = [11, 12, 13, 14, 15, 16, 17];
    flags.forEach((f, i) => expect(calcValue(doc, `=WEEKDAY("2016-07-24";${f})`)).toBe(7 - i));
    expect(calc(doc, '=WEEKDAY("2016-07-24";999999)')).toBe('Err:502');
    expect(calc(doc, '=WEEKDAY("2016-07-24";4)')).toBe('Err:502');
  });

  it('computes WEEKNUM, ISOWEEKNUM and WEEKNUM_OOO', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=WEEKNUM("2000-06-14")')).toBe(25);
    expect(calcValue(doc, '=WEEKNUM("1996-07-24";2)')).toBe(30);
    expect(calcValue(doc, '=WEEKNUM("2016-07-24";1)')).toBe(31);
    expect(calcValue(doc, '=WEEKNUM("2016-07-24";2)')).toBe(30);
    expect(calc(doc, '=WEEKNUM("2016-07-24";3)')).toBe('Err:502');
    expect(calcValue(doc, '=WEEKNUM("2021-01-01";21)')).toBe(53);
    expect(calcValue(doc, '=WEEKNUM("2016-07-24";17)')).toBe(31);
    expect(calcValue(doc, '=ISOWEEKNUM("1954-07-20")')).toBe(29);
    expect(calcValue(doc, '=ISOWEEKNUM(2000)')).toBe(25);
    expect(calcValue(doc, '=ISOWEEKNUM(0)')).toBe(52);
    expect(calcValue(doc, '=ISOWEEKNUM(99999)')).toBe(41);
    expect(calc(doc, '=ISOWEEKNUM("ab")')).toBe('#VALUE!');
    // Weeks with at least four days in the year, starting on Sunday (1) or Monday (other).
    expect(calcValue(doc, '=WEEKNUM_OOO("2021-01-03";1)')).toBe(1);
    expect(calcValue(doc, '=WEEKNUM_OOO("2021-01-02";1)')).toBe(53);
    expect(calcValue(doc, '=WEEKNUM_OOO("2021-01-03";2)')).toBe(53);
  });

  it('computes EASTERSUNDAY', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=EASTERSUNDAY("2015")')).toBe(serial(2015, 4, 5));
    expect(calcValue(doc, '=EASTERSUNDAY(2000)')).toBe(serial(2000, 4, 23));
    expect(calcValue(doc, '=EASTERSUNDAY(0)')).toBe(serial(2000, 4, 23));
    expect(calcValue(doc, '=EASTERSUNDAY(2024)')).toBe(serial(2024, 3, 31));
    expect(calc(doc, '=EASTERSUNDAY(2024)')).toBe('3/31/24');
    expect(calc(doc, '=EASTERSUNDAY("ab")')).toBe('#VALUE!');
    expect(calc(doc, '=EASTERSUNDAY(99999)')).toBe('Err:502');
    expect(calc(doc, '=EASTERSUNDAY(-1)')).toBe('Err:502');
  });

  it('computes DAYS, DAYS360 and DATEDIF', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=DAYS("1990-01-01";"1980-10-10")')).toBe(3370);
    expect(calc(doc, '=DAYS("Jan1, 1990";"1980-10-10")')).toBe('#VALUE!');
    // The Appendix B cases of the comment in ScGetDiffDate360.
    expect(calcValue(doc, '=DAYS360("1995-02-28";"1995-08-31")')).toBe(180);
    expect(calcValue(doc, '=DAYS360("1996-02-29";"1996-08-31")')).toBe(180);
    expect(calcValue(doc, '=DAYS360("1996-01-30";"1996-03-31")')).toBe(60);
    expect(calcValue(doc, '=DAYS360("1996-01-31";"1996-03-31")')).toBe(60);
    expect(calcValue(doc, '=DAYS360("1999-02-02";"2000-03-31")')).toBe(419);
    expect(calcValue(doc, '=DAYS360("2000-03-31";"1999-02-02")')).toBe(-418);
    expect(calcValue(doc, '=DAYS360("2000-03-31";"1999-02-02";1)')).toBe(-418);
    expect(calcValue(doc, '=DAYS360("2008-01-30";"2008-02-29";1)')).toBe(29);
    expect(calcValue(doc, '=DATEDIF("2012-01-28";"2012-03-01";"md")')).toBe(2);
    expect(calcValue(doc, '=DATEDIF("2011-01-29";"2011-03-01";"md")')).toBe(0);
    expect(calcValue(doc, '=DATEDIF("1988-06-22";"2012-05-11";"yd")')).toBe(324);
    expect(calcValue(doc, '=DATEDIF("1988-06-22";"2012-05-11";"y")')).toBe(23);
    expect(calcValue(doc, '=DATEDIF("1988-06-22";"2012-05-11";"m")')).toBe(286);
    expect(calcValue(doc, '=DATEDIF("1988-06-22";"2012-05-11";"YM")')).toBe(10);
    expect(calcValue(doc, '=DATEDIF("1988-06-22";"2012-05-11";"d")')).toBe(serial(2012, 5, 11) - serial(1988, 6, 22));
    expect(calc(doc, '=DATEDIF("2012-05-11";"1988-06-22";"d")')).toBe('Err:502');
    expect(calc(doc, '=DATEDIF("1988-06-22";"2012-05-11";"x")')).toBe('Err:502');
  });

  it('computes NETWORKDAYS and NETWORKDAYS.INTL', () => {
    const doc = newDoc();
    // Examples of the Excel documentation.
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31))')).toBe(22);
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;2;28);DATE(2006;1;31))')).toBe(-21);
    expect(calcValue(doc, '=NETWORKDAYS(DATE(2006;1;1);DATE(2006;1;31))')).toBe(22);
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);11)')).toBe(26);
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);"0000011")')).toBe(22);
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);"0000000")')).toBe(31);
    expect(calc(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);18)')).toBe('#VALUE!');
    expect(calc(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);"000001")')).toBe('#VALUE!');
    expect(calc(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;1;31);8)')).toBe('Err:502');
  });

  it('computes WORKDAY.INTL', () => {
    const doc = newDoc();
    // Examples of the Excel documentation.
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2012;1;1);90;11)')).toBe(41013);
    expect(calc(doc, '=WORKDAY.INTL(DATE(2012;1;1);90;11)')).toBe('4/14/12');
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2012;1;1);30;17)')).toBe(40944);
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2012;1;1);0)')).toBe(serial(2012, 1, 1));
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2024;1;8);-1)')).toBe(serial(2024, 1, 5));
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2024;1;5);1)')).toBe(serial(2024, 1, 8));
    expect(calc(doc, '=WORKDAY.INTL(DATE(2012;1;1);1;"1111111")')).toBe('#VALUE!');
  });

  it('skips holidays', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=DATE(2006;1;2)', A2: '=DATE(2006;1;16)', B1: '=DATE(2024;1;8)' });
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;2;1);7;A1:A2)')).toBe(22);
    expect(calcValue(doc, '=NETWORKDAYS.INTL(DATE(2006;1;1);DATE(2006;2;1);"0010001";A1:A2)')).toBe(20);
    expect(calcValue(doc, '=NETWORKDAYS(DATE(2006;1;1);DATE(2006;2;1);A1:A2)')).toBe(21);
    expect(calcValue(doc, '=NETWORKDAYS(DATE(2006;1;1);DATE(2006;2;1);;{1;0;0;0;0;0;1})')).toBe(23);
    // The weekend array runs from Sunday to Saturday, 1 for a weekend day.
    expect(calcValue(doc, '=NETWORKDAYS(DATE(2006;1;1);DATE(2006;2;1);;{1;1;1;1;1;0;0})')).toBe(8);
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2024;1;5);1;1;B1)')).toBe(serial(2024, 1, 9));
    expect(calcValue(doc, '=WORKDAY.INTL(DATE(2024;1;10);-2;1;B1)')).toBe(serial(2024, 1, 5));
  });

  it('formats results of cells as dates', () => {
    const doc = newDoc();
    putAll(doc, { A1: '=DATE(2024;3;1)', A2: '=A1+1', A3: '=YEAR(A1)' });
    expect(str(doc, 'A1')).toBe('3/1/24');
    expect(str(doc, 'A2')).toBe('3/2/24');
    expect(val(doc, 'A3')).toBe(2024);
    expect(str(doc, 'A3')).toBe('2024');
  });
});
