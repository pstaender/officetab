import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { ScAddress, ScRange } from '../../src/lo/sc/inc/address.ts';
import { CELLTYPE_EDIT, CELLTYPE_FORMULA, CELLTYPE_STRING, CELLTYPE_VALUE } from '../../src/lo/sc/inc/cellvalue.ts';
import { ScDocShell } from '../../src/lo/sc/source/ui/docshell/docsh.ts';
import { ExportCSV, ImportCSV, ReadCsvLine, ScImportExport, ScImportStringStream, SotClipboardFormatId } from '../../src/lo/sc/source/ui/docshell/impex.ts';
import { ScAsciiOptions, ScCsvExpData, SC_COL_DMY, SC_COL_ENGLISH, SC_COL_MDY, SC_COL_SKIP, SC_COL_TEXT, SC_COL_YMD, TagToLanguageType } from '../../src/lo/sc/source/ui/dbgui/asciiopt.ts';
import { ScImportOptions } from '../../src/lo/sc/source/ui/dbgui/imoptdlg.ts';
import { DetectCsvSeparators } from '../../src/lo/sfx2/source/doc/objstor.ts';
import { checkContent } from './calccsvcontent.ts';

const DATA = new URL('../../upstream/core/sc/qa/unit/data/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DATA), 'utf8');

/** The options of ConvertFrom without filter options (the test harness's load): comma, '"'. */
function apiOptions(): ScAsciiOptions {
  const o = new ScAsciiOptions();
  o.SetFieldSeps(',');
  o.SetTextSep('"');
  return o;
}

describe('ScAsciiOptions', () => {
  it('has upstream defaults', () => {
    const o = new ScAsciiOptions();
    expect(o.GetFieldSeps()).toBe(';');
    expect(o.GetTextSep()).toBe('"');
    expect(o.IsDetectSpecialNumber()).toBe(false);
    expect(o.IsDetectScientificNumber()).toBe(true);
    expect(o.IsEvaluateFormulas()).toBe(true);
    expect(o.GetStartRow()).toBe(1);
    expect(o.WriteToString()).toBe('59,34,76,1,,0,false,false,true,false,false,0,true,false,true');
  });

  it('reads and writes the filter options string', () => {
    const o = new ScAsciiOptions();
    o.ReadFromString('44/9/MRG,39,ANSI,3,1/2/3/9,1031,true,true,false,true,true,0,false,true,false');
    expect(o.GetFieldSeps()).toBe(',\t');
    expect(o.IsMergeSeps()).toBe(true);
    expect(o.GetTextSep()).toBe("'");
    expect(o.GetCharSet()).toBe('windows-1252');
    expect(o.GetStartRow()).toBe(3);
    expect(o.GetColStart()).toEqual([1, 3]);
    expect(o.GetColFormat()).toEqual([2, 9]);
    expect(o.GetLanguage()).toBe(1031);
    expect(o.IsQuotedAsText()).toBe(true);
    expect(o.IsDetectSpecialNumber()).toBe(true);
    expect(o.IsSaveAsShown()).toBe(false);
    expect(o.IsSaveFormulas()).toBe(true);
    expect(o.IsRemoveSpace()).toBe(true);
    expect(o.IsEvaluateFormulas()).toBe(false);
    expect(o.GetIncludeBOM()).toBe(true);
    expect(o.IsDetectScientificNumber()).toBe(false);
    expect(o.WriteToString()).toBe('44/9/MRG,39,ANSI,3,1/2/3/9,1031,true,true,false,true,true,0,false,true,false');
  });

  it('defaults missing tokens as versions without them', () => {
    const o = new ScAsciiOptions();
    o.ReadFromString('9,34,76');
    expect(o.GetFieldSeps()).toBe('\t');
    expect(o.IsDetectSpecialNumber()).toBe(true);
    expect(o.IsEvaluateFormulas()).toBe(true);
    expect(o.IsSaveAsShown()).toBe(true);
    o.ReadFromString('FIX,34,UTF8');
    expect(o.IsFixedLen()).toBe(true);
    expect(o.GetCharSet()).toBe('utf-8');
  });

  it('detects separators with DETECT', () => {
    const o = new ScAsciiOptions();
    o.ReadFromString('DETECT,34,76', new ScImportStringStream('a;b;c\n1;2;3\n'));
    expect(o.GetFieldSeps()).toBe(';');
  });

  it('weights the export separator', () => {
    expect(ScAsciiOptions.GetWeightedFieldSep(';\t,', false)).toBe(',');
    expect(ScAsciiOptions.GetWeightedFieldSep('59/9', true)).toBe('\t');
    expect(ScAsciiOptions.GetWeightedFieldSep('', false)).toBe('');
  });

  it('sets column info', () => {
    const o = new ScAsciiOptions();
    o.SetColumnInfo([new ScCsvExpData(1, SC_COL_TEXT), new ScCsvExpData(2, SC_COL_SKIP)]);
    expect(o.WriteToString().split(',')[4]).toBe('1/2/2/9');
  });
});

describe('ScImportOptions', () => {
  it('reads the export options of the ScAsciiOptions string', () => {
    const o = new ScImportOptions('44,34,76,1,,0,true,true,false,true,false,0,true,true');
    expect(o.nFieldSepCode).toBe(',');
    expect(o.nTextSepCode).toBe('"');
    expect(o.eCharSet).toBe('utf-8');
    expect(o.bQuoteAllText).toBe(true);
    expect(o.bSaveNumberAsSuch).toBe(true);
    expect(o.bSaveAsShown).toBe(false);
    expect(o.bSaveFormulas).toBe(true);
    expect(o.bIncludeBOM).toBe(true);
  });
  it('builds its string', () => {
    const o = new ScImportOptions(',', '"', 'utf-8');
    expect(o.BuildString()).toBe('44,34,76,1,,0,false,true,false,false,false,0,true,false');
    expect(new ScImportOptions('44,34,76,0').bQuoteAllText).toBe(true);
  });
});

describe('DetectCsvSeparators', () => {
  const detect = (s: string) => DetectCsvSeparators(new ScImportStringStream(s), '"');
  it('finds the separator on every line with constant count', () => {
    expect(detect('a,b,c\n1,2,3\n')).toBe(',');
    expect(detect('a\tb\n1\t2\n')).toBe('\t');
    expect(detect('a;b c\nd;e f g\n')).toBe(';');
  });
  it('skips quoted text and reads sep=', () => {
    expect(detect('"a;b",c\n"d;e",f\n')).toBe(',');
    expect(detect('sep=|\na|b\n')).toBe('|');
    expect(detect('"sep=;"\na;b\n')).toBe(';');
  });
  it('restores the stream position', () => {
    const s = new ScImportStringStream('a,b\n');
    DetectCsvSeparators(s, '');
    expect(s.Tell()).toBe(0);
  });
});

describe('ReadCsvLine', () => {
  const lines = (text: string, seps = ',') => {
    const s = new ScImportStringStream(text);
    const out: string[] = [];
    for (;;) {
      const l = ReadCsvLine(s, true, { v: seps }, '"', { v: '￿' });
      if (s.eof() && !l) break;
      out.push(l);
    }
    return out;
  };
  it('joins quoted line breaks', () => {
    expect(lines('a,"b\nc",d\ne,f\n')).toEqual(['a,"b\nc",d', 'e,f']);
    expect(lines('a,"b\r\nc"\r\nx\r\n')).toEqual(['a,"b\nc"', 'x']);
  });
  it('takes one line for an unclosed quote', () => {
    expect(lines('"a,b\nc,d\n')).toEqual(['"a,b', 'c,d']);
  });
  it('keeps empty lines and the last line without line end', () => {
    expect(lines('a\n\nb')).toEqual(['a', '', 'b']);
  });
  it('detects a separator after a closing quote and rereads', () => {
    const seps = { v: '' };
    const det = { v: '\0' };
    const s = new ScImportStringStream('"a";"b\nc"\n');
    expect(ReadCsvLine(s, true, seps, '"', det)).toBe('"a";"b\nc"');
    expect(seps.v).toBe(';');
  });
});

describe('ScImportExport::ScanNextFieldFromString', () => {
  const fields = (line: string, seps = ',', bMerge = false, bRemoveSpace = false) => {
    const out: [string, boolean][] = [];
    let p = 0;
    const f = { v: '' }, q = { v: false }, o = { v: false };
    while (p < line.length) {
      p = ScImportExport.ScanNextFieldFromString(line, p, f, '"', seps, bMerge, q, o, bRemoveSpace);
      out.push([f.v, q.v]);
    }
    return out;
  };
  it('reads quoted fields with doubled quotes', () => {
    expect(fields('a,"b,c","d""e"')).toEqual([['a', false], ['b,c', true], ['d"e', true]]);
  });
  it('copes with blanks before quotes and broken quotes', () => {
    expect(fields('"a", "b"')).toEqual([['a', true], ['b', true]]);
    expect(fields('"abc" d "ef",x')).toEqual([['abc" d "ef', true], ['x', false]]);
  });
  it('merges separators and trims spaces', () => {
    expect(fields('a,,b', ',', true)).toEqual([['a', false], ['b', false]]);
    expect(fields(' a , b ', ',', false, true)).toEqual([['a', false], ['b', false]]);
  });
});

describe('ImportCSV', () => {
  it('detects the separator and reads numbers and text', () => {
    const doc = ImportCSV('Name;Price\nApple;1.5\n"Pear; green";2\n').GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('Name');
    expect(doc.GetValue(1, 1, 0)).toBe(1.5);
    expect(doc.GetString(0, 2, 0)).toBe('Pear; green');
    expect(doc.GetCellType(new ScAddress(1, 2, 0))).toBe(CELLTYPE_VALUE);
  });

  it('keeps embedded line breaks as multi-line cells', () => {
    const doc = ImportCSV('a,"line1\nline2",c\n').GetDocument();
    expect(doc.GetCellType(new ScAddress(1, 0, 0))).toBe(CELLTYPE_EDIT);
    expect(doc.GetString(1, 0, 0)).toBe('line1\nline2');
    expect(doc.GetString(2, 0, 0)).toBe('c');
  });

  it('evaluates formulas by default and keeps them as text when told not to', () => {
    let doc = ImportCSV('1,2,=A1+B1\n').GetDocument();
    expect(doc.GetCellType(new ScAddress(2, 0, 0))).toBe(CELLTYPE_FORMULA);
    expect(doc.GetValue(2, 0, 0)).toBe(3);
    const o = apiOptions();
    o.SetEvaluateFormulas(false);
    doc = ImportCSV('1,2,=A1+B1\n', o).GetDocument();
    expect(doc.GetCellType(new ScAddress(2, 0, 0))).toBe(CELLTYPE_STRING);
    expect(doc.GetString(2, 0, 0)).toBe('=A1+B1');
  });

  it('detects special numbers only with the option, ISO dates always', () => {
    let doc = ImportCSV('1/2/2021,50%,2021-03-04\n', apiOptions()).GetDocument();
    expect(doc.GetCellType(new ScAddress(0, 0, 0))).toBe(CELLTYPE_STRING);
    expect(doc.GetCellType(new ScAddress(1, 0, 0))).toBe(CELLTYPE_STRING);
    expect(doc.GetCellType(new ScAddress(2, 0, 0))).toBe(CELLTYPE_VALUE);
    expect(doc.GetValue(2, 0, 0)).toBe(44259);
    const o = apiOptions();
    o.SetDetectSpecialNumber(true);
    doc = ImportCSV('1/2/2021,50%\n', o).GetDocument();
    expect(doc.GetValue(0, 0, 0)).toBe(44198);
    expect(doc.GetValue(1, 0, 0)).toBe(0.5);
  });

  it('reads quoted fields as text with the option', () => {
    const o = apiOptions();
    o.SetQuotedAsText(true);
    const doc = ImportCSV('"12",12\n', o).GetDocument();
    expect(doc.GetCellType(new ScAddress(0, 0, 0))).toBe(CELLTYPE_STRING);
    expect(doc.GetNumberFormat(0, 0, 0)).toBe('@');
    expect(doc.GetCellType(new ScAddress(1, 0, 0))).toBe(CELLTYPE_VALUE);
  });

  it('honours column types', () => {
    const o = apiOptions();
    o.ReadFromString(`44,34,76,1,1/${SC_COL_TEXT}/2/${SC_COL_DMY}/3/${SC_COL_MDY}/4/${SC_COL_YMD}/5/${SC_COL_SKIP}/6/${SC_COL_ENGLISH}`);
    const doc = ImportCSV('007,15.03.2021,Mar 15 2021,2021-03-15,skipped,1.5\n', o).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('007');
    expect(doc.GetValue(1, 0, 0)).toBe(44270);
    expect(doc.GetValue(2, 0, 0)).toBe(44270);
    expect(doc.GetValue(3, 0, 0)).toBe(44270);
    expect(doc.GetValue(4, 0, 0)).toBe(1.5);
  });

  it('reads dates with time and AM/PM, and digit-only dates', () => {
    const o = apiOptions();
    o.ReadFromString(`44,34,76,1,1/${SC_COL_MDY}/2/${SC_COL_DMY}`);
    const doc = ImportCSV('03/15/2021 1:30 PM,150321\n', o).GetDocument();
    expect(doc.GetValue(0, 0, 0)).toBeCloseTo(44270 + 13.5 / 24, 9);
    expect(doc.GetValue(1, 0, 0)).toBe(44270);
  });

  it('parses numbers in the language of the options', () => {
    const o = apiOptions();
    o.SetFieldSeps(';');
    o.SetLanguage(TagToLanguageType('de-DE'));
    const doc = ImportCSV('1,5;2\n', o).GetDocument();
    expect(doc.GetValue(0, 0, 0)).toBe(1.5);
  });

  it('starts at a row and merges separators', () => {
    const o = apiOptions();
    o.SetStartRow(2);
    o.SetMergeSeps(true);
    const doc = ImportCSV('skip me\na,,b\n', o).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('a');
    expect(doc.GetString(1, 0, 0)).toBe('b');
  });

  it('reads fixed width columns', () => {
    const o = new ScAsciiOptions();
    o.ReadFromString(`FIX,34,76,1,0/1/5/${SC_COL_TEXT}`);
    const doc = ImportCSV('abc  12345\n', o).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('abc');
    expect(doc.GetString(1, 0, 0)).toBe('12345');
    expect(doc.GetCellType(new ScAddress(1, 0, 0))).toBe(CELLTYPE_STRING);
  });

  it('reports the BOM in the options', () => {
    const o = apiOptions();
    ImportCSV('﻿a,b\n', o);
    expect(o.GetIncludeBOM()).toBe(true);
  });
});

describe('upstream csv files', () => {
  const files = [
    ...readdirSync(new URL('csv/', DATA)).map((f) => `csv/${f}`),
    ...readdirSync(new URL('contentCSV/', DATA)).map((f) => `contentCSV/${f}`),
  ];
  it.each(files)('imports %s', (f) => {
    const text = read(f);
    expect(() => ImportCSV(text)).not.toThrow();
    expect(() => ImportCSV(text, apiOptions())).not.toThrow();
  });

  // sc/qa/unit/subsequent_filters_test.cxx
  it('testBrokenQuotesCSV (fdo#48621)', () => {
    const doc = ImportCSV(read('csv/fdo48621_broken_quotes.csv'), apiOptions()).GetDocument();
    expect(checkContent(doc, 0, 'fdo48621_broken_quotes_exported.csv', true)).toEqual([]);
  });

  it('testTdf150452', () => {
    const doc = ImportCSV(read('csv/tdf150452.csv'), apiOptions()).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('1-GDUSF');
    expect(doc.GetString(0, 3998, 0)).toBe('1-GE41L');
  });

  it('testTdf48731', () => {
    const doc = ImportCSV(read('csv/tdf48731.csv'), apiOptions()).GetDocument();
    expect(doc.GetString(1, 1, 0)).toBe("'");
    expect(doc.GetString(1, 2, 0)).toBe("''");
    expect(doc.GetString(1, 3, 0)).toBe("'''");
    expect(doc.GetString(1, 4, 0)).toBe("'3");
    expect(doc.GetString(1, 5, 0)).toBe("'word");
    expect(doc.GetString(1, 6, 0)).toBe("'mword");
    expect(doc.GetString(1, 9, 0)).toBe("'");
    expect(doc.GetString(1, 10, 0)).toBe("''");
    expect(doc.GetString(1, 11, 0)).toBe("'''");
    expect(doc.GetString(1, 12, 0)).toBe("'3");
    expect(doc.GetString(1, 13, 0)).toBe("'word");
    expect(doc.GetString(1, 14, 0)).toBe("'mword");
  });

  // sc/qa/unit/subsequent_filters_test4.cxx
  it('testNumberFormatCSV', () => {
    for (const doc of [ImportCSV(read('csv/numberformat.csv'), apiOptions()).GetDocument(), ImportCSV(read('csv/numberformat.csv')).GetDocument()]) {
      expect(doc.GetString(0, 0, 0)).toBe('Product');
      expect(doc.GetString(1, 0, 0)).toBe('Price');
      expect(doc.GetString(2, 0, 0)).toBe('Note');
      expect(doc.HasValueData(1, 1, 0)).toBe(true);
      expect(doc.GetValue(1, 1, 0)).toBe(199.98);
    }
  });

  // sc/qa/unit/subsequent_export_test3.cxx (the import part)
  it('testTdf80149', () => {
    const doc = ImportCSV(read('csv/tdf80149.csv'), apiOptions()).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('row 1');
    expect(doc.GetString(1, 0, 0)).toBe('Character 0x16 is here ->>\x16<<--');
    expect(doc.GetString(2, 0, 0)).toBe("File opens in libre office, but can't be saved as xlsx");
    expect(doc.GetString(0, 1, 0)).toBe('row 2');
    expect(doc.GetString(1, 1, 0)).toBe('Subsequent rows get truncated');
    expect(doc.GetString(2, 1, 0)).toBe('This cell goes missing');
  });

  // sc/qa/unit/subsequent_export_test4.cxx (the import part)
  it('testTdf152980', () => {
    const doc = ImportCSV(read('csv/tdf152980.csv'), apiOptions()).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('a_x1_b');
    expect(doc.GetString(0, 1, 0)).toBe('a_x01_b');
    expect(doc.GetString(0, 2, 0)).toBe('a_x001_b');
    expect(doc.GetString(0, 3, 0)).toBe('a_x0001_b');
    expect(doc.GetString(0, 4, 0)).toBe('a_xfoo\nb');
    expect(doc.GetString(0, 5, 0)).toBe('a\tb');
    expect(doc.GetString(0, 6, 0)).toBe('a\nb');
    expect(doc.GetString(0, 7, 0)).toBe('a\n\nb');
  });

  // sc/qa/unit/subsequent_export_test3.cxx: the BOM survives a round trip
  it('testTdf82254_csv_bom', () => {
    const o = apiOptions();
    const sh = ImportCSV(read('csv/testTdf82254-csv-bom.csv'), o);
    expect(o.GetIncludeBOM()).toBe(true);
    expect(ExportCSV(sh, 0, o).startsWith('﻿')).toBe(true);
    expect(ExportCSV(sh, 0, apiOptions()).startsWith('﻿')).toBe(false);
  });

  // sc/qa/unit/subsequent_filters_test3.cxx: tdf#152053 is a column width test; the ISO dates
  // are imported as dates.
  it('tdf152053 imports ISO dates as values', () => {
    const doc = ImportCSV(read('csv/tdf152053.csv')).GetDocument();
    expect(doc.GetString(0, 0, 0)).toBe('Date');
    expect(doc.GetCellType(new ScAddress(0, 1, 0))).toBe(CELLTYPE_VALUE);
    expect(doc.GetValue(0, 1, 0)).toBe(44194);
  });
});

describe('ExportCSV', () => {
  function sheet(cells: Record<string, string | number>): ScDocShell {
    const sh = new ScDocShell();
    const doc = sh.GetDocument();
    for (const [k, v] of Object.entries(cells)) {
      const a = new ScAddress(0, 0, 0);
      a.Parse(k, doc);
      if (typeof v === 'number') doc.SetValue(a, v);
      else doc.SetString(a, v);
    }
    return sh;
  }

  it('writes rows with separators, quoting text that needs it', () => {
    const sh = sheet({ A1: 'a', B1: 'b,c', C1: 'say "hi"', A2: 1.5, C2: ' x' });
    expect(ExportCSV(sh, 0)).toBe('a,"b,c","say ""hi"""\n1.5,, x\n');
  });

  it('fills empty rows and columns up to the used area', () => {
    const sh = sheet({ A1: 'a', C3: 'c' });
    expect(ExportCSV(sh, 0)).toBe('a,,\n,,\n,,c\n');
  });

  it('writes values as shown or as stored, and formulas', () => {
    const sh = sheet({ A1: 0.125, B1: '=A1*2' });
    const doc = sh.GetDocument();
    doc.SetNumberFormat(new ScAddress(0, 0, 0), '0.0');
    expect(ExportCSV(sh, 0)).toBe('0.1,0.25\n');
    const o = new ScImportOptions(',', '"', 'utf-8');
    expect(ExportCSV(sh, 0, o)).toBe('0.125,0.25\n');
    o.bSaveFormulas = true;
    expect(ExportCSV(sh, 0, o)).toBe('0.125,=A1*2\n');
  });

  it('quotes all text cells with the option and writes multi-line text quoted', () => {
    const sh = sheet({ A1: 'a', B1: 2 });
    const o = new ScImportOptions(',', '"', 'utf-8');
    o.bSaveAsShown = true;
    o.bQuoteAllText = true;
    expect(ExportCSV(sh, 0, o)).toBe('"a",2\n');
    const sh2 = ImportCSV('"x\ny",z\n');
    expect(ExportCSV(sh2, 0)).toBe('"x\ny",z\n');
  });

  it('writes the current separator for a sep= cell', () => {
    const sh = sheet({ A1: 'sep=,', A2: 'a', B2: 'b' });
    const o = new ScAsciiOptions();
    o.SetFieldSeps(';');
    expect(ExportCSV(sh, 0, o)).toBe('"sep=;"\na;b\n');
  });

  it('writes fixed width columns', () => {
    const sh = sheet({ A1: 'ab', B1: 12 });
    const o = new ScImportOptions('FIX,34,76');
    o.bSaveAsShown = true;
    const s = ExportCSV(sh, 0, o);
    const n = s.indexOf('12');
    expect(s.slice(0, 2)).toBe('ab');
    expect(s.endsWith('12\n')).toBe(true);
    expect(n).toBeGreaterThan(2);
  });

  it('round trips', () => {
    const text = 'Name,Value,Note\nApple,1.5,"red, round"\nPear,2,"say ""hi"""\n,,\nx,"a\nb",3\n';
    const sh = ImportCSV(text);
    expect(ExportCSV(sh, 0)).toBe(text);
    const sh2 = ImportCSV(ExportCSV(sh, 0));
    expect(ExportCSV(sh2, 0)).toBe(text);
    for (const f of ['csv/fdo48621_broken_quotes.csv', 'csv/numberformat.csv', 'csv/tdf152980.csv']) {
      const a = ImportCSV(read(f), apiOptions());
      const out = ExportCSV(a, 0);
      const b = ImportCSV(out, apiOptions());
      expect(ExportCSV(b, 0)).toBe(out);
    }
  });
});

describe('ScImportExport text', () => {
  it('imports tab separated text at a position (Text2Doc) and exports a range (Doc2Text)', () => {
    const sh = new ScDocShell();
    const doc = sh.GetDocument();
    const imp = new ScImportExport(doc, new ScAddress(1, 1, 0), sh);
    expect(imp.ImportString('a\tb\n1\t2\n', SotClipboardFormatId.STRING)).toBe(true);
    expect(doc.GetString(1, 1, 0)).toBe('a');
    expect(doc.GetValue(2, 2, 0)).toBe(2);
    const exp = new ScImportExport(doc, new ScRange(0, 0, 0, 5, 5, 0));
    expect(exp.ExportString(SotClipboardFormatId.STRING)).toBe('a\tb\n1\t2\n');
  });
});
