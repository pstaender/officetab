// Calc text functions; expected values from upstream's sc/qa/unit/data/functions/text/fods.
import { describe, expect, it } from 'vitest';
import { calc, calcValue, newDoc, putAll } from './calchelper.ts';

describe('Calc text functions', () => {
  it('LEFT, RIGHT, MID count code points', () => {
    const doc = newDoc();
    putAll(doc, { I1: 'Sale Price', I11: 'ab😂de𝔖gh𝕬𝖈𝖍𝖙𝖚𝖓𝖌!', I12: '"𧌒𧀬"', I2: 'ahoj' });
    expect(calc(doc, '=LEFT(I1;4)')).toBe('Sale');
    expect(calc(doc, '=LEFT(I1)')).toBe('S');
    expect(calc(doc, '=LEFT("Calc";25)')).toBe('Calc');
    expect(calc(doc, '=LEFT("Calc";)')).toBe('');
    expect(calc(doc, '=LEFT("Calc";0)')).toBe('');
    expect(calc(doc, '=LEFT("Calc";-1)')).toBe('Err:502');
    expect(calc(doc, '=LEFT(I11;4)')).toBe('ab😂d');
    expect(calc(doc, '=LEFT(I12;2)')).toBe('"𧌒');
    expect(calc(doc, '=RIGHT("Calc";2)')).toBe('lc');
    expect(calc(doc, '=RIGHT("Calc")')).toBe('c');
    expect(calc(doc, '=RIGHT(I11;5)')).toBe('𝖙𝖚𝖓𝖌!');
    expect(calc(doc, '=RIGHT("Calc";-1)')).toBe('Err:502');
    expect(calc(doc, '=MID("office";2;2)')).toBe('ff');
    expect(calc(doc, '=MID(I2;2;8)')).toBe('hoj');
    expect(calc(doc, '=MID(I2;12;8)')).toBe('');
    expect(calc(doc, '=MID(I2;0;3)')).toBe('Err:502');
    expect(calc(doc, '=MID(I11;2;2)')).toBe('b😂');
    expect(calc(doc, '=MID("𝕬𝖈𝖍𝖙𝖚𝖓𝖌!";3;3)')).toBe('𝖍𝖙𝖚');
    expect(calcValue(doc, '=LEN(I11)')).toBe(16);
    expect(calcValue(doc, '=LEN("")')).toBe(0);
    expect(calcValue(doc, '=LEN(12.5)')).toBe(4);
  });

  it('FIND and SEARCH', () => {
    const doc = newDoc();
    putAll(doc, { I1: 'LibreOffice', I2: 'Miriam McGovern', J16: 'ab😂de𝔖gh𝕬𝖈𝖍𝖙𝖚𝖓𝖌!' });
    expect(calcValue(doc, '=FIND(76;998877665544)')).toBe(6);
    expect(calcValue(doc, '=FIND("M";I2)')).toBe(1);
    expect(calcValue(doc, '=FIND("m";I2)')).toBe(6);
    expect(calcValue(doc, '=FIND("M";I2;3)')).toBe(8);
    expect(calc(doc, '=FIND("B😂";J16)')).toBe('#VALUE!');
    expect(calcValue(doc, '=FIND("😂d";J16)')).toBe(3);
    expect(calcValue(doc, '=FIND("h";J16)')).toBe(8);
    expect(calc(doc, '=FIND("x";"abc";0)')).toBe('#VALUE!');
    expect(calcValue(doc, '=SEARCH(54;998877665544)')).toBe(10);
    expect(calcValue(doc, '=SEARCH("off";I1)')).toBe(6);
    expect(calcValue(doc, '=SEARCH("OFf";I1)')).toBe(6);
    expect(calcValue(doc, '=SEARCH("off";I1;2)')).toBe(6);
    expect(calc(doc, '=SEARCH("off";I1;7)')).toBe('#VALUE!');
    expect(calcValue(doc, '=SEARCH("e";I1)')).toBe(5);
    expect(calcValue(doc, '=SEARCH("e";I1;6)')).toBe(11);
    expect(calc(doc, '=SEARCH("e";I1;0)')).toBe('Err:502');
    expect(calcValue(doc, '=SEARCH("b😂";J16)')).toBe(2);
    // Wildcards (the default formula search type), ~ escapes.
    expect(calcValue(doc, '=SEARCH("O*e";I1)')).toBe(6);
    expect(calcValue(doc, '=SEARCH("?f";I1)')).toBe(6);
    expect(calcValue(doc, '=SEARCH("~?";"a?b")')).toBe(2);
    expect(calc(doc, '=SEARCH("~*";"abc")')).toBe('#VALUE!');
  });

  it('SUBSTITUTE, REPLACE, REPT', () => {
    const doc = newDoc();
    putAll(doc, { I3: 'Quarter 1, 2008', I4: 'Quarter 1, 2011', I12: 'B😂c😂d' });
    expect(calc(doc, '=SUBSTITUTE("123123123";"3";"abc")')).toBe('12abc12abc12abc');
    expect(calc(doc, '=SUBSTITUTE("123123123";"3";"abc";2)')).toBe('12312abc123');
    expect(calc(doc, '=SUBSTITUTE(I3;"1";"2";1)')).toBe('Quarter 2, 2008');
    expect(calc(doc, '=SUBSTITUTE(I4;"1";"2";3)')).toBe('Quarter 1, 2012');
    expect(calc(doc, '=SUBSTITUTE(I3;"1";"2";0)')).toBe('Err:502');
    expect(calc(doc, '=SUBSTITUTE("abc";"";"x")')).toBe('abc');
    expect(calc(doc, '=REPLACE("1234567";1;1;"444")')).toBe('444234567');
    expect(calc(doc, '=REPLACE("abcdefghijk";6;5;"*")')).toBe('abcde*k');
    expect(calc(doc, '=REPLACE("123456789";5;0;"Q")')).toBe('1234Q56789');
    expect(calc(doc, '=REPLACE("abcdefghijk";77;1;"xx")')).toBe('abcdefghijkxx');
    expect(calc(doc, '=REPLACE("123456789";0;0;"Q")')).toBe('Err:502');
    expect(calc(doc, '=REPLACE("";5;1;"Q")')).toBe('Q');
    expect(calc(doc, '=REPLACE(I12;3;1;"xXx")')).toBe('B😂xXx😂d');
    expect(calc(doc, '=REPLACE(I12;1;2;"xYx")')).toBe('xYxc😂d');
    expect(calc(doc, '=REPT("*-";3)')).toBe('*-*-*-');
    expect(calc(doc, '=REPT("-";0)')).toBe('');
    expect(calc(doc, '=REPT("-";-1)')).toBe('Err:502');
  });

  it('UPPER, LOWER, PROPER, TRIM, CLEAN, EXACT, T', () => {
    const doc = newDoc();
    putAll(doc, { I1: 'this is a TITLE', I2: '2-way street', I3: '76BudGet', J1: 5, J2: 'x', J3: '=1/0' });
    expect(calc(doc, '=UPPER("ąbc")')).toBe('ĄBC');
    expect(calc(doc, '=LOWER("ĄBC")')).toBe('ąbc');
    expect(calc(doc, '=PROPER(I1)')).toBe('This Is A Title');
    expect(calc(doc, '=PROPER(I2)')).toBe('2-Way Street');
    expect(calc(doc, '=PROPER(I3)')).toBe('76Budget');
    expect(calc(doc, '=PROPER("HELLO.THERE")')).toBe('Hello.There');
    expect(calc(doc, '=PROPER("\'don\'t\'")')).toBe("'Don'T'");
    expect(calc(doc, '=PROPER()')).toBe('Err:511');
    expect(calc(doc, '=TRIM("  apples ")')).toBe('apples');
    expect(calc(doc, '=TRIM(" LO    Office ")')).toBe('LO Office');
    expect(calc(doc, '=CLEAN("Test"&CHAR(7)&" text"&UNICHAR(127)&UNICHAR(128))')).toBe('Test text');
    expect(calc(doc, '=CLEAN("~Test text~")')).toBe('~Test text~');
    expect(calc(doc, '=EXACT("Text1";"Text2")')).toBe('FALSE');
    expect(calc(doc, '=EXACT("word";"word")')).toBe('TRUE');
    expect(calc(doc, '=EXACT("Word";"word")')).toBe('FALSE');
    expect(calc(doc, '=T(0)')).toBe('');
    expect(calc(doc, '=T("x")')).toBe('x');
    expect(calc(doc, '=T(J1)')).toBe('');
    expect(calc(doc, '=T(J2)')).toBe('x');
    expect(calc(doc, '=T(J3)')).toBe('#DIV/0!');
    expect(calc(doc, '=T(NA())')).toBe('#N/A');
  });

  it('CHAR, CODE, UNICHAR, UNICODE', () => {
    const doc = newDoc();
    expect(calc(doc, '=CHAR(65)')).toBe('A');
    expect(calc(doc, '=CHAR(128)')).toBe('€');
    expect(calc(doc, '=CHAR(256)')).toBe('Err:502');
    expect(calcValue(doc, '=CODE("Hello")')).toBe(72);
    expect(calcValue(doc, '=CODE("€")')).toBe(128);
    expect(calcValue(doc, '=CODE("")')).toBe(0);
    expect(calcValue(doc, '=UNICODE("F")')).toBe(70);
    expect(calcValue(doc, '=UNICODE(0)')).toBe(48);
    expect(calcValue(doc, '=UNICODE("😂")')).toBe(0x1f602);
    expect(calc(doc, '=UNICODE("")')).toBe('Err:504');
    expect(calc(doc, '=UNICHAR(66)')).toBe('B');
    expect(calc(doc, '=UNICHAR(128514)')).toBe('😂');
    expect(calc(doc, '=UNICHAR(-1)')).toBe('Err:502');
    expect(calc(doc, '=UNICHAR(1114112)')).toBe('Err:502');
  });

  it('CONCATENATE, CONCAT, TEXTJOIN', () => {
    const doc = newDoc();
    putAll(doc, {
      I2: 'brook trout', I3: 'species', I4: 32, J2: 'Andreas',
      M2: 'OK', M3: 'WA', A1: 'Function',
      R1: "A's", R2: 'a1', R3: 'a2', R5: 'a4', S1: "B's", S2: 'b1', S3: 'b2', S5: 'b4',
      L8: ',', M8: ';',
    });
    expect(calc(doc, '=CONCATENATE("a";1;"b")')).toBe('a1b');
    expect(calc(doc, '=CONCATENATE(I2;" ";J2)')).toBe('brook trout Andreas');
    expect(calc(doc, '=CONCAT("Good ";"Morning ";"Mrs. ";"Doe")')).toBe('Good Morning Mrs. Doe');
    expect(calc(doc, '=CONCAT("Stream population for ";I2;" ";I3;" is ";I4;"/mile.")')).toBe('Stream population for brook trout species is 32/mile.');
    expect(calc(doc, '=CONCAT(R1:R5;S1:S5)')).toBe("A'sa1a2a4B'sb1b2b4");
    expect(calc(doc, '=CONCAT(R1:S2)')).toBe("A'sB'sa1b1");
    expect(calc(doc, '=CONCAT({1;2;"x"})')).toBe('12x');
    expect(calc(doc, '=TEXTJOIN(" ";1;"The";"sun";"will";"come";"up";"tomorrow.")')).toBe('The sun will come up tomorrow.');
    expect(calc(doc, '=TEXTJOIN(", ";1;R1:S5)')).toBe("A's, B's, a1, b1, a2, b2, a4, b4");
    expect(calc(doc, '=TEXTJOIN(", ";0;R1:R5)')).toBe("A's, a1, a2, , a4");
    expect(calc(doc, '=TEXTJOIN(L8:M8;1;R2:S3)')).toBe('a1,b1;a2,b2');
    expect(calc(doc, '=TEXTJOIN(;1;M2;M3)')).toBe('OKWA');
    expect(calc(doc, '=TEXTJOIN(A1;1;M2;M3)')).toBe('OKFunctionWA');
    expect(calc(doc, '=TEXTJOIN(1;1;M2;M3)')).toBe('OK1WA');
    expect(calc(doc, '=TEXTJOIN(;;M2;M3)')).toBe('OKWA');
    expect(calc(doc, '=TEXTJOIN(",";1)')).toBe('Err:511');
  });

  it('TEXT, FIXED, DOLLAR', () => {
    const doc = newDoc();
    putAll(doc, { I1: 0, J1: 11.2, J2: 12.2, J3: 13.2, J8: '2000-01-01', K1: '1,234,567.890' });
    expect(calc(doc, '=TEXT(12.34567;"###.##")')).toBe('12.35');
    expect(calc(doc, '=TEXT(12.34567;"000.00")')).toBe('012.35');
    expect(calc(doc, '=TEXT(I1;"YYYY-MM-DD")')).toBe('1899-12-30');
    expect(calc(doc, '=TEXT(I1;"YYYY-MM-DD HH:MM:SS")')).toBe('1899-12-30 00:00:00');
    expect(calc(doc, '=TEXT("3e";"0")')).toBe('3e');
    expect(calc(doc, '=TEXT(1234.567;"$#,##0.00")')).toBe('$1,234.57');
    expect(calc(doc, '=TEXT(0.285;"0.0%")')).toBe('28.5%');
    expect(calc(doc, '=TEXT(12200000;"0.00E+00")')).toBe('1.22E+07');
    expect(calc(doc, '=TEXT(1234;"0000000")')).toBe('0001234');
    expect(calc(doc, '=TEXT(J1)')).toBe('Err:511');
    expect(calc(doc, '=TEXT(J1;"0")')).toBe('11');
    expect(calc(doc, '=TEXT(J2;"0.0")')).toBe('12.2');
    expect(calc(doc, '=TEXT(J3;0)')).toBe('13');
    expect(calc(doc, '=TEXT(J8;"YYYY/MM/DD")')).toBe('2000/01/01');
    expect(calc(doc, '=TEXT(J8;"DD/MM/yyyy")')).toBe('01/01/2000');
    expect(calc(doc, '=TEXT(5;"")')).toBe('');
    expect(calc(doc, '=TEXT("abc";"")')).toBe('abc');
    expect(calc(doc, '=TEXT("abc";"[@]")')).toBe('abc');
    expect(calc(doc, '=FIXED(1234567.89;3)')).toBe('1,234,567.890');
    expect(calc(doc, '=FIXED(1234567.89;3;1)')).toBe('1234567.890');
    expect(calc(doc, '=FIXED(K1;-1)')).toBe('1,234,570');
    expect(calc(doc, '=FIXED(52.1254)')).toBe('52.13');
    expect(calc(doc, '=FIXED(K1;-1;2)')).toBe('1234570');
    expect(calc(doc, '=FIXED(1;16)')).toBe('Err:502');
    expect(calc(doc, '=DOLLAR(255)')).toBe('$255.00');
    expect(calc(doc, '=DOLLAR(367.456;2)')).toBe('$367.46');
    expect(calc(doc, '=DOLLAR(1234.567;2)')).toBe('$1,234.57');
    expect(calc(doc, '=DOLLAR(1234.567;-2)')).toBe('$1,200');
    expect(calc(doc, '=DOLLAR(-1234.567;-2)')).toBe('-$1,200');
    expect(calc(doc, '=DOLLAR(-0.123;4)')).toBe('-$0.1230');
    expect(calc(doc, '=DOLLAR(99.888)')).toBe('$99.89');
  });

  it('VALUE and NUMBERVALUE', () => {
    const doc = newDoc();
    putAll(doc, { I1: 'test', I2: '\'1', I3: '01/01/2000', I4: '123/456' });
    expect(calcValue(doc, '=VALUE("4321")')).toBe(4321);
    expect(calc(doc, '=VALUE(I1)')).toBe('Err:502');
    expect(calcValue(doc, '=VALUE(I2)')).toBe(1);
    expect(calcValue(doc, '=VALUE(I3)')).toBe(36526);
    expect(calcValue(doc, '=VALUE(F1)')).toBe(0);
    expect(calcValue(doc, '=VALUE("$1,000")')).toBe(1000);
    expect(calcValue(doc, '=ROUND(VALUE("16:48:00")-VALUE("12:00:00");10)')).toBe(0.2);
    expect(calcValue(doc, '=NUMBERVALUE("   123.456     ";".";",")')).toBe(123.456);
    expect(calcValue(doc, '=NUMBERVALUE(I4;"/")')).toBe(123.456);
    expect(calcValue(doc, '=NUMBERVALUE("2.500,27";",";".")')).toBe(2500.27);
    expect(calcValue(doc, '=NUMBERVALUE("35%")')).toBeCloseTo(0.35, 14);
    expect(calc(doc, '=NUMBERVALUE("3.5%")')).toBe('#VALUE!');
    expect(calcValue(doc, '=NUMBERVALUE("3.5%";".")')).toBeCloseTo(0.035, 14);
    expect(calc(doc, '=NUMBERVALUE("   123.456     ";".";".")')).toBe('Err:502');
    expect(calcValue(doc, '=NUMBERVALUE("  ")')).toBe(0);
    expect(calc(doc, '=NUMBERVALUE("123//22";"//")')).toBe('Err:502');
  });

  it('REGEX', () => {
    const doc = newDoc();
    expect(calc(doc, '=REGEX("Needle in a haystack";".e{2}dle")')).toBe('Needle');
    expect(calc(doc, '=REGEX("LibreOffice text  101";"[0-9]+")')).toBe('101');
    expect(calc(doc, '=REGEX("The price today is $826.25";"[0-9]*\\.[0-9]+[0-9]+")')).toBe('826.25');
    expect(calc(doc, '=REGEX("(Content) between brackets";"\\(([A-Za-z]+)\\)")')).toBe('(Content)');
    expect(calc(doc, '=REGEX("The end";"^The";"AA")')).toBe('AA end');
    expect(calc(doc, '=REGEX("The end";"^BBe";"AA")')).toBe('The end');
    expect(calc(doc, '=REGEX("The end";"^The";"AA";"g")')).toBe('AA end');
    expect(calc(doc, '=REGEX("abcabc";"b";"X";"g")')).toBe('aXcaXc');
    expect(calc(doc, '=REGEX("abcabc";"b";"X";2)')).toBe('abcaXc');
    expect(calc(doc, '=REGEX("abcabc";"b";;2)')).toBe('b');
    expect(calc(doc, '=REGEX("abcabc";"b";;3)')).toBe('#N/A');
    expect(calc(doc, '=REGEX("abc";"(b)";"[$1]")')).toBe('a[b]c');
    expect(calc(doc, '=REGEX("abc";"b";"$2")')).toBe('Err:502');
    expect(calc(doc, '=REGEX("abc";"b";"\\$")')).toBe('a$c');
    expect(calc(doc, '=REGEX("abc";"(")')).toBe('Err:502');
    expect(calc(doc, '=REGEX("abc";"b";"X";"x")')).toBe('Err:502');
  });

  it('the byte variants', () => {
    const doc = newDoc();
    expect(calcValue(doc, '=LENB("abc")')).toBe(3);
    expect(calcValue(doc, '=LENB("日本語")')).toBe(6);
    expect(calc(doc, '=LEFTB("日本語";3)')).toBe('日 ');
    expect(calc(doc, '=LEFTB("日本語";4)')).toBe('日本');
    expect(calc(doc, '=RIGHTB("日本語";3)')).toBe(' 語');
    expect(calc(doc, '=MIDB("日本語";3;2)')).toBe('本');
    expect(calc(doc, '=REPLACEB("日本語";3;2;"x")')).toBe('日x語');
    expect(calcValue(doc, '=FINDB("語";"日本語")')).toBe(5);
    expect(calcValue(doc, '=SEARCHB("B";"日abc")')).toBe(4);
  });

  it('TEXTBEFORE, TEXTAFTER, TEXTSPLIT', () => {
    const doc = newDoc();
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";" ")')).toBe('Red');
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";" ";2)')).toBe('Red riding');
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";" ";-1)')).toBe('Red riding');
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";"X")')).toBe('#N/A');
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";"X";;;;"none")')).toBe('none');
    expect(calc(doc, '=TEXTBEFORE("Red riding hood";"R";2;1)')).toBe('Red ');
    expect(calc(doc, '=TEXTAFTER("Red riding hood";" ")')).toBe('riding hood');
    expect(calc(doc, '=TEXTAFTER("Red riding hood";" ";-1)')).toBe('hood');
    expect(calc(doc, '=TEXTAFTER("Red riding hood";" ";3;;1)')).toBe('');
    expect(calc(doc, '=TEXTSPLIT("a,b,c";",")')).toBe('a');
    expect(calc(doc, '=TEXTJOIN("|";0;TEXTSPLIT("a,b;c";",";";";;;"-"))')).toBe('a|b|c|-');
    expect(calc(doc, '=TEXTJOIN("|";0;TEXTSPLIT("a,,b";","))')).toBe('a||b');
    expect(calc(doc, '=TEXTJOIN("|";0;TEXTSPLIT("a,,b";",";;1))')).toBe('a|b');
    expect(calc(doc, '=TEXTJOIN("|";0;TEXTSPLIT("a,b;c";",";";"))')).toBe('#N/A');
    expect(calc(doc, '=FIND("";"abc")')).toBe('#VALUE!');
  });
});
