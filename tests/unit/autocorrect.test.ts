// SPDX-License-Identifier: MPL-2.0
// Tools > AutoCorrect: corrections while typing (SvxAutoCorrect through SwAutoCorrDoc), the
// formatting while typing when Enter ends a paragraph, and Apply (SwAutoFormat).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SwDoc } from '../../src/lo/sw/inc/doc.ts';
import { SwWrtShell } from '../../src/lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { ACFlags, SvxAutoCorrect, type SvxAutoCorrLangData } from '../../src/lo/editeng/source/misc/svxacorr.ts';
import { SvxAutoCorrCfg } from '../../src/lo/editeng/source/misc/acorrcfg.ts';
import { SvxSwAutoFormatFlags } from '../../src/lo/editeng/source/misc/swafopt.ts';
import { SwEditShell_SetAutoFormatFlags } from '../../src/lo/sw/source/core/edit/autofmt.ts';
import { NumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import type { FontDesc, TextMeasurer } from '../../src/lo/vcl/source/outdev/text.ts';
import type { SwTextNode } from '../../src/lo/sw/inc/ndtxt.ts';

const mono: TextMeasurer = { GetTextWidth: (_f: FontDesc, t: string) => [...t].length * 100, GetFontMetric: () => ({ ascent: 200, descent: 40 }) };
const enUS = JSON.parse(readFileSync(join(import.meta.dirname, '../../src/shell/generated/autocorr/en-US.json'), 'utf8')) as SvxAutoCorrLangData;
const quotes = JSON.parse(readFileSync(join(import.meta.dirname, '../../src/shell/generated/quotes.json'), 'utf8')) as Record<string, string>;

let acorr: SvxAutoCorrect;
let saved: Record<string, SvxAutoCorrLangData>;

/** The defaults of Office.Common/AutoCorrect, as SvxBaseAutoCorrCfg::Load sets them. */
function configDefaults(a: SvxAutoCorrect): void {
  a.nFlags = ACFlags.Autocorrect | ACFlags.CapitalStartWord | ACFlags.CapitalStartSentence | ACFlags.SetINetAttr | ACFlags.SetDOIAttr
    | ACFlags.ChgOrdinalNumber | ACFlags.ChgToEnEmDash | ACFlags.AddNonBrkSpace | ACFlags.TransliterateRTL | ACFlags.ChgAngleQuotes
    | ACFlags.CorrectCapsLock | ACFlags.ChgSglQuotes | ACFlags.ChgQuotes | ACFlags.SaveWordCplSttLst | ACFlags.SaveWordWordStartLst;
}

beforeEach(() => {
  const cfg = SvxAutoCorrCfg.Get();
  acorr = new SvxAutoCorrect(new SvxSwAutoFormatFlags());
  cfg.SetAutoCorrect(acorr);
  configDefaults(acorr);
  saved = {};
  acorr.SetListLoader((lang) => (lang === 'en-US' || lang === 'en' ? { sLanguage: 'en-US', data: structuredClone(enUS) } : undefined), (lang, data) => { saved[lang] = data; });
  acorr.SetLocaleQuotes((lang) => quotes[lang]);
  SwEditShell_SetAutoFormatFlags(acorr.GetSwFlags());
});

/** Types text as SwEditWin::KeyInput does with AutoCorrect while typing; '\n' is Enter. */
function type(sh: SwWrtShell, text: string): void {
  for (const c of text) {
    if (c === '\n') sh.SplitNode(true);
    else if (SvxAutoCorrect.IsAutoCorrectChar(c)) sh.AutoCorrect(acorr, c);
    else sh.Insert(c);
  }
}
const paras = (sh: SwWrtShell): SwTextNode[] => {
  const out: SwTextNode[] = [];
  const nodes = sh.m_pDoc.GetNodes();
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) out.push(n);
  return out;
};
const texts = (sh: SwWrtShell) => paras(sh).map((n) => n.GetText());

describe('AutoCorrect while typing', () => {
  it('replaces words from the replacement table', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'see teh dog --> 1/2 :cent: ');
    expect(texts(sh)).toEqual(['See the dog → ½ ¢ ']);
  });

  it('capitalizes sentences and corrects two initial capitals', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'this is TWo words. next one, e.g. no. ');
    expect(texts(sh)).toEqual(['This is Two words. Next one, e.g. no. ']);
  });

  it('keeps words of the exception lists', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'Two CDs ');
    expect(texts(sh)).toEqual(['Two CDs ']);
  });

  it('replaces dashes', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'A - b and c--d ');
    expect(texts(sh)).toEqual(['A – b and c—d ']);
  });

  it('formats ordinal number suffixes as superscript', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'The 1st ');
    const n = paras(sh)[0]!;
    expect(n.GetText()).toBe('The 1st ');
    expect(n.GetCharAttrAt('RES_CHRATR_ESCAPEMENT', 5)).toBeGreaterThan(0);
    expect(n.GetCharAttrAt('RES_CHRATR_ESCAPEMENT', 4)).toBe(0);
  });

  it('sets bold, italic and strikeout when the option is on', () => {
    acorr.SetAutoCorrFlag(ACFlags.ChgWeightUnderl, true);
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'A *bold* word ');
    const n = paras(sh)[0]!;
    expect(n.GetText()).toBe('A bold word ');
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 3)).toBe(true);
    expect(n.GetCharAttrAt('RES_CHRATR_WEIGHT', 8)).toBe(false);
  });

  it('recognises URLs', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'Go to www.example.org now');
    const n = paras(sh)[0]!;
    expect(n.GetCharAttrAt('RES_TXTATR_INETFMT', 8)).toBe('http://www.example.org');
  });

  it('replaces quotes with the language\'s typographic ones', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'He said "yes" and it\'s fine ');
    expect(texts(sh)).toEqual(['He said “yes” and it’s fine ']);
  });

  it('undoes the correction but not the typing', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'see teh ');
    expect(texts(sh)).toEqual(['See the ']);
    sh.Undo(acorr);
    expect(texts(sh)).toEqual(['See teh ']);
  });

  it('adds an undone capital correction to the exceptions (AutoInclude)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'Use ABc ');
    expect(texts(sh)).toEqual(['Use Abc ']);
    sh.Undo(acorr);
    expect(texts(sh)).toEqual(['Use ABc ']);
    expect(saved['en-US']?.word).toContain('ABc');
  });

  it('changes nothing with AutoCorrect while typing switched off', () => {
    acorr.nFlags = 0;
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'teh "x" ');
    expect(texts(sh)).toEqual(['teh "x" ']);
  });
});

describe('AutoFormat while typing (Enter)', () => {
  it('makes a numbered list of a paragraph starting with "1. "', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, '1. First\nSecond');
    const [a, b] = paras(sh);
    expect(texts(sh)).toEqual(['First', 'Second']);
    const rule = sh.m_pDoc.FindNumRulePtr(a!.GetAttr('RES_PARATR_NUMRULE'));
    expect(rule).toBeTruthy();
    expect(rule!.Get(0).GetNumberingType()).toBe(NumberingType.ARABIC);
    expect(b!.GetAttr('RES_PARATR_NUMRULE')).toBe(rule!.GetName());
    // Enter on the empty numbered paragraph ends the list (SwEditWin), as before.
  });

  it('recognises Roman numbers and the start value', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'ii. Item\n');
    const rule = sh.m_pDoc.FindNumRulePtr(paras(sh)[0]!.GetAttr('RES_PARATR_NUMRULE'))!;
    expect(paras(sh)[0]!.GetText()).toBe('Item');
    const f = rule.Get(0);
    expect(f.GetNumberingType()).toBe(NumberingType.ROMAN_LOWER);
    expect(f.GetStart()).toBe(2);
  });

  it('does not take letters for a numbering (SwAutoFormat::GetDigitLevel)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'b) Item\n');
    expect(paras(sh)[0]!.GetAttr('RES_PARATR_NUMRULE')).toBeFalsy();
  });

  it('makes a bulleted list of a paragraph starting with "- "', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, '- Item\n');
    const n = paras(sh)[0]!;
    expect(n.GetText()).toBe('Item');
    const rule = sh.m_pDoc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'))!;
    expect(rule.Get(0).GetNumberingType()).toBe(NumberingType.CHAR_SPECIAL);
    expect(rule.Get(0).GetBulletChar()).toBe('–');
  });

  it('leaves the paragraph alone with the option off', () => {
    const flags = acorr.GetSwFlags();
    flags.bSetNumRule = false;
    SwEditShell_SetAutoFormatFlags(flags);
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, '1. First\n');
    expect(texts(sh)).toEqual(['1. First', '']);
    expect(paras(sh)[0]!.GetAttr('RES_PARATR_NUMRULE')).toBeFalsy();
  });

  it('undoes the numbering separately from the new paragraph', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, '1. First\n');
    expect(texts(sh)).toEqual(['First', '']);
    sh.Undo(acorr);
    expect(texts(sh)).toEqual(['1. First', '']);
    sh.Undo(acorr);
    expect(texts(sh)).toEqual(['1. First']);
  });

  it('draws a border for a line of dashes when "Apply border" is on', () => {
    const flags = acorr.GetSwFlags();
    flags.bSetBorder = true;
    SwEditShell_SetAutoFormatFlags(flags);
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'Text\n---\n');
    const [a] = paras(sh);
    expect(a!.GetText()).toBe('Text');
    expect(a!.GetAttr('RES_BOX')?.bottom).toBeTruthy();
  });

  it('makes a table of a line drawn with + and - (Create table)', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'Text\n+-----+-----+-----+\n');
    const nodes = sh.m_pDoc.GetNodes();
    let table = null;
    for (let i = 0; i < nodes.Count(); i++) if (nodes.node(i).IsTableNode()) table = nodes.node(i);
    expect(table).toBeTruthy();
    expect(texts(sh)).not.toContain('+-----+-----+-----+');
  });

  it('corrects the last word of the paragraph Enter ends', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    type(sh, 'see teh\n');
    expect(texts(sh)).toEqual(['See the', '']);
  });
});

describe('AutoCorrect > Apply', () => {
  it('styles headings and body text and corrects the text', () => {
    const f = acorr.GetSwFlags();
    f.bReplaceStyles = true;
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Paste('Introduction\n\nthis is teh text of a paragraph.\n1. one\n2. two');
    const flags = acorr.GetSwFlags().Clone();
    flags.bAFormatByInput = false;
    sh.AutoFormat(flags);
    const p = paras(sh);
    expect(p[0]!.GetTextColl().GetName()).toBe('Heading 1');
    expect(p[2]!.GetText()).toBe('This is the text of a paragraph.');
    // BuildText keeps the paragraph's style.
    expect(p[2]!.GetTextColl().GetName()).toBe('Standard');
    expect(p[3]!.GetTextColl().GetName()).toBe('Numbering 1');
    // Without list numbering (only while typing), the number stays, followed by a tab.
    expect(p[3]!.GetText()).toBe('1.\tone');
  });

  it('records the changes with Apply and Edit Changes', () => {
    const sh = new SwWrtShell(new SwDoc(), mono);
    sh.Paste('see teh dog');
    const flags = acorr.GetSwFlags().Clone();
    flags.bAFormatByInput = false;
    flags.bWithRedlining = true;
    sh.AutoFormat(flags);
    expect(sh.GetRedlineTable().length).toBeGreaterThan(0);
    expect(sh.IsRedlineOn()).toBe(false);
  });
});
