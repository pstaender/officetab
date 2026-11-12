// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/numrule.hxx reduced
// @upstream sw/source/core/doc/number.cxx reduced
// @upstream include/editeng/numitem.hxx reduced
// @upstream editeng/source/items/numitem.cxx reduced
// @upstream sw/source/core/doc/DocumentStylePoolManager.cxx partial
// Only the LABEL_ALIGNMENT position-and-space mode (Writer's default since 3.0) is ported.
// Character styles of labels and graphic bullets are not ported: labels use the paragraph font with
// weight, posture and underline reset, as SwTextFormatter::NewNumberPortion does, and bullets their
// bullet font.
import { NumberingType, makeNumberingString } from '../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { LocaleOf, type Locale } from '../../i18npool/source/nativenumber/nativenumbersupplier.ts';
import type { SvxAdjust } from './hintids.ts';

export const MAXLEVEL = 10;
/** Character for lists. */
export const cBulletChar = '•';

export type SvxNumLabelFollowedBy = 'listtab' | 'space' | 'nothing' | 'newline';

export class SwNumFormat {
  m_eNumberingType: NumberingType = NumberingType.ARABIC;
  m_cBullet = cBulletChar;
  m_nStart = 1;
  m_nInclUpperLevels = 1;
  m_sPrefix = '';
  m_sSuffix = '';
  m_sListFormat: string | null = null;
  m_eNumAdjust: SvxAdjust = 'left';
  m_eLabelFollowedBy: SvxNumLabelFollowedBy = 'listtab';
  m_nListtabPos = 0;
  m_nFirstLineIndent = 0;
  m_nIndentAt = 0;

  Clone(): SwNumFormat { return Object.assign(new SwNumFormat(), this); }

  GetNumberingType(): NumberingType { return this.m_eNumberingType; }
  SetNumberingType(t: NumberingType): void { this.m_eNumberingType = t; }
  GetBulletChar(): string { return this.m_cBullet; }
  SetBulletChar(c: string): void { this.m_cBullet = c; }
  /** SvxNumberFormat::GetBulletFont, by family name; null uses the paragraph's font. */
  m_sBulletFont: string | null = null;
  GetBulletFont(): string | null { return this.m_sBulletFont; }
  SetBulletFont(f: string | null): void { this.m_sBulletFont = f; }
  GetStart(): number { return this.m_nStart; }
  SetStart(n: number): void { this.m_nStart = n; }
  GetIncludeUpperLevels(): number { return this.m_nInclUpperLevels; }
  SetIncludeUpperLevels(n: number): void { this.m_nInclUpperLevels = Math.min(n, MAXLEVEL); }
  GetPrefix(): string { return this.m_sPrefix; }
  GetSuffix(): string { return this.m_sSuffix; }
  HasListFormat(): boolean { return this.m_sListFormat !== null; }
  GetNumAdjust(): SvxAdjust { return this.m_eNumAdjust; }
  SetNumAdjust(a: SvxAdjust): void { this.m_eNumAdjust = a; }
  GetLabelFollowedBy(): SvxNumLabelFollowedBy { return this.m_eLabelFollowedBy; }
  SetLabelFollowedBy(f: SvxNumLabelFollowedBy): void { this.m_eLabelFollowedBy = f; }
  GetListtabPos(): number { return this.m_nListtabPos; }
  SetListtabPos(n: number): void { this.m_nListtabPos = n; }
  GetFirstLineIndent(): number { return this.m_nFirstLineIndent; }
  SetFirstLineIndent(n: number): void { this.m_nFirstLineIndent = n; }
  GetIndentAt(): number { return this.m_nIndentAt; }
  SetIndentAt(n: number): void { this.m_nIndentAt = n; }

  /** SvxNumberFormat::SetListFormat(rPrefix, rSuffix, nLevel) */
  SetListFormat(rPrefix: string, rSuffix: string, nLevel: number): void {
    this.m_sPrefix = rPrefix;
    this.m_sSuffix = rSuffix;

    // Generate list format
    let s = this.m_sPrefix;
    for (let i = 1; i <= this.m_nInclUpperLevels; i++) {
      const nLevelId = nLevel - this.m_nInclUpperLevels + i;
      if (nLevelId < 0)
        // There can be cases with current level 1, but request to show 10 upper levels. Trim it
        continue;
      s += `%${nLevelId + 1}%`;
      if (i !== this.m_nInclUpperLevels) s += '.'; // Default separator for older ODT
    }
    this.m_sListFormat = s + this.m_sSuffix;
  }

  /** SvxNumberFormat::SetListFormat(std::optional<OUString>): prefix and suffix are derived. */
  SetListFormatString(o: string | null): void {
    this.m_sPrefix = '';
    this.m_sSuffix = '';
    this.m_sListFormat = o;
    if (o === null) return;
    const first = o.search(/%[1-9]/);
    const lastMatch = [...o.matchAll(/%(?:10|[1-9])%/g)].pop();
    if (first < 0 || !lastMatch) return;
    this.m_sPrefix = o.slice(0, first);
    this.m_sSuffix = o.slice(lastMatch.index + lastMatch[0].length);
  }

  GetListFormat(bIncludePrefixSuffix = true): string {
    const s = this.m_sListFormat ?? '';
    if (bIncludePrefixSuffix) return s;
    // Strip prefix & suffix from string
    return s.slice(this.m_sPrefix.length, s.length - this.m_sSuffix.length);
  }

  /** SvxNumberType::GetNumStr(nNo, rLocale): the locale matters to native and spelled-out numbers. */
  GetNumStr(nNo: number, aLocale?: Locale): string { return makeNumberingString(this.m_eNumberingType, nNo, aLocale); }

  IsEnumeration(): boolean {
    const t = this.m_eNumberingType;
    return t !== NumberingType.CHAR_SPECIAL && t !== NumberingType.BITMAP && t !== NumberingType.NUMBER_NONE;
  }
  IsItemize(): boolean { return this.m_eNumberingType === NumberingType.CHAR_SPECIAL || this.m_eNumberingType === NumberingType.BITMAP; }
}

// SwDefBulletConfig defaults; the user configuration is not ported.
const mnLevelChars = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪', '•'];
export const numfunc = {
  GetBulletChar: (nLevel: number): string => mnLevelChars[Math.min(nLevel, MAXLEVEL - 1)]!,
};

export class SwNumRule {
  m_aFormats: SwNumFormat[] = [];
  msName: string;
  /** Automatic rules belong to paragraphs (ODF automatic list styles); others are list styles. */
  mbAutoRuleFlag = true;
  mbContinusNum = false;

  constructor(aNm: string) {
    this.msName = aNm;
    // saLabelAlignmentBaseFormats[NUM_RULE]: first line indent -0.25 inch, indents 0.5 inch apart by 0.25.
    const cFirstLineIndent = -360;
    for (let n = 0; n < MAXLEVEL; ++n) {
      const f = new SwNumFormat();
      f.SetIncludeUpperLevels(1);
      f.SetStart(1);
      f.SetLabelFollowedBy('listtab');
      f.SetListtabPos(720 + n * 360);
      f.SetFirstLineIndent(cFirstLineIndent);
      f.SetIndentAt(720 + n * 360);
      f.SetListFormat('', '.', n);
      f.SetBulletChar(numfunc.GetBulletChar(n));
      this.m_aFormats.push(f);
    }
  }

  GetName(): string { return this.msName; }
  Get(i: number): SwNumFormat { return this.m_aFormats[Math.max(0, Math.min(i, MAXLEVEL - 1))]!; }
  Set(i: number, f: SwNumFormat): void { this.m_aFormats[i] = f.Clone(); }
  IsAutoRule(): boolean { return this.mbAutoRuleFlag; }
  SetAutoRule(b: boolean): void { this.mbAutoRuleFlag = b; }
  IsContinusNum(): boolean { return this.mbContinusNum; }

  Clone(name = this.msName): SwNumRule {
    const r = new SwNumRule(name);
    r.m_aFormats = this.m_aFormats.map((f) => f.Clone());
    r.mbAutoRuleFlag = this.mbAutoRuleFlag;
    r.mbContinusNum = this.mbContinusNum;
    return r;
  }

  /** SwNumRule::MakeNumString(rNumVector, bInclStrings, ..., nLang): nLang is a BCP 47 tag. */
  MakeNumString(rNumVector: number[], bInclStrings = true, nLang?: string): string {
    const aLocale = LocaleOf(nLang);
    const nLevel = rNumVector.length - 1;
    const rMyNFormat = this.Get(nLevel);

    if (rMyNFormat.GetNumberingType() === NumberingType.NUMBER_NONE) {
      // since numbering is disabled for this level,
      // only emit prefix/suffix (unless they are not wanted either)
      if (!bInclStrings) return '';
      return rMyNFormat.GetPrefix() + rMyNFormat.GetSuffix();
    }

    if (rMyNFormat.HasListFormat()) {
      let sLevelFormat = rMyNFormat.GetListFormat(bInclStrings);

      // In this case we are ignoring GetIncludeUpperLevels: we put all
      // level numbers requested by level format
      for (let nPosition = 0; nPosition < sLevelFormat.length - 2;) {
        if (sLevelFormat[nPosition] !== '%') { ++nPosition; continue; }
        let nReplaceLevel: number;
        let nEndPosition: number;
        if (sLevelFormat[nPosition + 1] === '1' && sLevelFormat[nPosition + 2] === '0'
          && nPosition + 3 < sLevelFormat.length && sLevelFormat[nPosition + 3] === '%') {
          nReplaceLevel = 9; // special case %10%
          nEndPosition = nPosition + 4;
        } else if (sLevelFormat[nPosition + 2] === '%' && sLevelFormat[nPosition + 1]! >= '1' && sLevelFormat[nPosition + 1]! <= '9') {
          nReplaceLevel = sLevelFormat.charCodeAt(nPosition + 1) - 49; // need to subtract 1
          nEndPosition = nPosition + 3;
        } else {
          ++nPosition;
          continue; // ignore it
        }
        if (nLevel < nReplaceLevel) {
          nPosition = nEndPosition;
          // there is no number to insert - in this case Word 2013
          continue; // shows no label at all, we just skip it
        }

        const rNFormat = this.Get(nReplaceLevel);
        if (rNFormat.GetNumberingType() === NumberingType.NUMBER_NONE) {
          // Numbering disabled - replacement is empty
          // And we should skip all level string content until next level marker:
          // so %1%.%2%.%3% with second level as NONE will result 1.1, not 1..1
          const nPositionNext = sLevelFormat.indexOf('%', nEndPosition);
          if (nPositionNext > nPosition) sLevelFormat = sLevelFormat.slice(0, nPosition) + sLevelFormat.slice(nPositionNext);
          continue;
        }

        const sReplacement = rNumVector[nReplaceLevel] ? rNFormat.GetNumStr(rNumVector[nReplaceLevel]!, aLocale) : '0'; // all 0 level are a 0
        sLevelFormat = sLevelFormat.slice(0, nPosition) + sReplacement + sLevelFormat.slice(nEndPosition);
        nPosition += sReplacement.length;
      }
      return sLevelFormat;
    }

    // Fallback case: level format is not defined
    // So use old way with levels joining by dot "."
    let aStr = '';
    let i = nLevel;
    if (!this.IsContinusNum() && rMyNFormat.GetNumberingType() !== NumberingType.NUMBER_NONE && rMyNFormat.GetIncludeUpperLevels()) {
      const n = rMyNFormat.GetIncludeUpperLevels();
      if (1 < n) i = i + 1 >= n ? i - (n - 1) : 0;
    }
    for (; i <= nLevel; ++i) {
      const rNFormat = this.Get(i);
      if (rNFormat.GetNumberingType() === NumberingType.NUMBER_NONE) continue;
      aStr += rNumVector[i] ? rNFormat.GetNumStr(rNumVector[i]!, aLocale) : '0'; // all 0 level are a 0
      if (i !== nLevel && aStr) aStr += '.';
    }
    // The type doesn't have any number, so don't append the post-/prefix string
    if (bInclStrings && rMyNFormat.GetNumberingType() !== NumberingType.CHAR_SPECIAL && rMyNFormat.GetNumberingType() !== NumberingType.BITMAP) {
      aStr = rMyNFormat.GetPrefix() + aStr + rMyNFormat.GetSuffix();
    }
    return aStr;
  }
}

/** Programmatic names of the pool list styles (STR_POOLNUMRULE_*), as `.uno:StyleApply` uses them. */
export const POOL_NUMRULES = ['List 1', 'Numbering 123', 'Numbering ABC', 'Numbering abc', 'Numbering IVX', 'Numbering ivx'] as const;
export const POOL_NUMRULE_UI: Record<string, string> = {
  'List 1': 'Bullet •', 'Numbering 123': 'Numbering 123', 'Numbering ABC': 'Numbering ABC',
  'Numbering abc': 'Numbering abc', 'Numbering IVX': 'Numbering IVX', 'Numbering ivx': 'Numbering ivx',
};

/** DocumentStylePoolManager::GetNumRuleFromPool, LABEL_ALIGNMENT branches only. */
export function GetNumRuleFromPool(name: (typeof POOL_NUMRULES)[number]): SwNumRule {
  const pNewRule = new SwNumRule(name);
  pNewRule.SetAutoRule(false);
  const aFormat = new SwNumFormat();
  aFormat.SetStart(1);
  aFormat.SetIncludeUpperLevels(1);
  aFormat.SetLabelFollowedBy('listtab');
  switch (name) {
    case 'Numbering 123': {
      aFormat.SetNumberingType(NumberingType.ARABIC);
      //              cm: 0.7 cm intervals, with 1 cm = 567
      const aAbsSpace = [397, 794, 1191, 1588, 1985, 2381, 2778, 3175, 3572, 3969];
      aFormat.SetFirstLineIndent(-aAbsSpace[0]!);
      for (let n = 0; n < MAXLEVEL; ++n) {
        aFormat.SetListFormat('', '.', n);
        aFormat.SetListtabPos(aAbsSpace[n]!);
        aFormat.SetIndentAt(aAbsSpace[n]! + 357);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
    case 'Numbering ABC': {
      const aAbsSpace = [397, 397, 397, 397, 397, 397, 397, 397, 397, 397]; // 0.70 cm intervals
      aFormat.SetNumberingType(NumberingType.CHARS_UPPER_LETTER);
      let nSpace = 357; // indent of 0.63 cm
      for (let n = 0; n < MAXLEVEL; ++n) {
        aFormat.SetListFormat('', '.', n);
        nSpace += aAbsSpace[n]!;
        aFormat.SetListtabPos(nSpace);
        aFormat.SetIndentAt(nSpace);
        aFormat.SetFirstLineIndent(-aAbsSpace[n]!);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
    case 'Numbering abc': {
      aFormat.SetNumberingType(NumberingType.CHARS_LOWER_LETTER);
      const nOffs = 397; // 0.70 cm
      aFormat.SetFirstLineIndent(-nOffs);
      for (let n = 0; n < MAXLEVEL; ++n) {
        aFormat.SetListFormat('', '.', n);
        const nPos = (n + 1) * nOffs;
        aFormat.SetListtabPos(nPos + 357);
        aFormat.SetIndentAt(nPos + 357);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
    case 'Numbering IVX': {
      aFormat.SetNumberingType(NumberingType.ROMAN_UPPER);
      aFormat.SetNumAdjust('right');
      //              cm: 1.33 cm intervals
      const aAbsSpace = [754, 1508, 2262, 3016, 3771, 4525, 5279, 6033, 6787, 7541];
      aFormat.SetFirstLineIndent(580 - aAbsSpace[0]!);
      for (let n = 0; n < MAXLEVEL; ++n) {
        aFormat.SetListFormat('', '.', n);
        aFormat.SetListtabPos(aAbsSpace[n]!);
        aFormat.SetIndentAt(aAbsSpace[n]!);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
    case 'Numbering ivx': {
      // [ First, LSpace ]
      const aAbsSpace0to2 = [174, 754, 174, 1508, 397, 2262];
      aFormat.SetNumberingType(NumberingType.ROMAN_LOWER);
      aFormat.SetNumAdjust('right');
      aFormat.SetListFormat('', '.', 0);
      aFormat.SetFirstLineIndent(-aAbsSpace0to2[0]!);
      aFormat.SetListtabPos(aAbsSpace0to2[1]!);
      aFormat.SetIndentAt(aAbsSpace0to2[1]!);
      pNewRule.Set(0, aFormat);
      aFormat.SetNumberingType(NumberingType.ROMAN_UPPER);
      aFormat.SetIncludeUpperLevels(1);
      aFormat.SetListFormat('', '.', 1);
      aFormat.SetFirstLineIndent(-aAbsSpace0to2[2]!);
      aFormat.SetListtabPos(aAbsSpace0to2[3]!);
      aFormat.SetIndentAt(aAbsSpace0to2[3]!);
      pNewRule.Set(1, aFormat);
      aFormat.SetNumberingType(NumberingType.CHARS_LOWER_LETTER);
      aFormat.SetIncludeUpperLevels(1);
      aFormat.SetListFormat('', ')', 2);
      aFormat.SetNumAdjust('left');
      aFormat.SetFirstLineIndent(-aAbsSpace0to2[4]!);
      aFormat.SetListtabPos(aAbsSpace0to2[5]!);
      aFormat.SetIndentAt(aAbsSpace0to2[5]!);
      pNewRule.Set(2, aFormat);
      aFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
      aFormat.SetBulletChar(cBulletChar);
      const nOffs = Math.round((660 * 1440) / 2540), nOffs2 = Math.round((4000 * 1440) / 2540);
      aFormat.SetFirstLineIndent(-nOffs);
      for (let n = 3; n < MAXLEVEL; ++n) {
        aFormat.SetStart(n + 1);
        aFormat.SetListFormat('', '', n);
        const nPos = nOffs2 + (n - 2) * nOffs;
        aFormat.SetListtabPos(nPos);
        aFormat.SetIndentAt(nPos);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
    case 'List 1': {
      aFormat.SetNumberingType(NumberingType.CHAR_SPECIAL);
      aFormat.SetBulletChar(cBulletChar);
      //              cm: 0,4  0,8  1,2  1,6  2,0   2,4   2,8   3,2   3,6   4,0
      const aAbsSpace = [227, 454, 680, 907, 1134, 1361, 1587, 1814, 2041, 2268];
      aFormat.SetFirstLineIndent(-aAbsSpace[0]!);
      for (let n = 0; n < MAXLEVEL; ++n) {
        aFormat.SetListtabPos(aAbsSpace[n]!);
        aFormat.SetIndentAt(aAbsSpace[n]!);
        pNewRule.Set(n, aFormat);
      }
      break;
    }
  }
  return pNewRule;
}
