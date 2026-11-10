// SPDX-License-Identifier: MPL-2.0
// @upstream cui/source/tabpages/numpages.cxx reduced
// The Bullets and Numbering dialog's tab pages as functions of the rule being edited: each handler
// changes the levels in the level mask (nActNumLvl) of a copy of the rule (pActNum). The value sets'
// previews, the Image page, character styles of labels and the bullet's relative size are not
// ported; Customize offers the numbering types the numbering provider has.
import { NumberingType } from '../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { getContinuousNumberingLevels, getOutlineNumberingLevels } from '../../../i18npool/source/localedata/data/en_US.ts';
import { MAXLEVEL, SwNumRule, type SvxNumLabelFollowedBy } from '../../../sw/inc/numrule.ts';
import type { SvxAdjust } from '../../../sw/inc/hintids.ts';

/** All levels (SAL_MAX_UINT16): the mask when the selection has no list yet. */
export const ALL_LEVELS = 0xffff;

/** officecfg Office.Common/BulletsNumbering: DefaultBullets and DefaultBulletsFonts. */
export const m_aBulletSymbols = ['●', '○', '□', '►', '→', '-', '–', '✸'];
export const m_aBulletSymbolsFonts = ['OpenSymbol', 'OpenSymbol', 'OpenSymbol', 'OpenSymbol', 'OpenSymbol', 'OpenSymbol', 'OpenSymbol', 'OpenSymbol'];
/** SVX_DEF_BULLET is OpenSymbol's private-use bullet (0xF000 + 149); this is its Unicode one. */
const SVX_DEF_BULLET = '•';
/** lcl_GetDefaultBulletFont */
const DEFAULT_BULLET_FONT = 'OpenSymbol';

/** A copy of the rule with the levels in the mask changed (SvxNumRule::SetLevel on pActNum). */
function forLevels(pActNum: SwNumRule, nActNumLvl: number, change: (f: ReturnType<SwNumRule['Get']>, i: number) => void): SwNumRule {
  const r = pActNum.Clone();
  let nMask = 1;
  for (let i = 0; i < MAXLEVEL; i++) {
    if (nActNumLvl & nMask) {
      const aFmt = r.Get(i).Clone();
      change(aFmt, i);
      r.Set(i, aFmt);
    }
    nMask <<= 1;
  }
  return r;
}

/** SvxBulletPickTabPage::NumSelectHdl_Impl: bullet `nIndex` (0-based) of the bullet library. */
export function BulletPick(pActNum: SwNumRule, nActNumLvl: number, nIndex: number): SwNumRule {
  const cChar = m_aBulletSymbols[nIndex]!;
  const font = m_aBulletSymbolsFonts[nIndex]!;
  return forLevels(pActNum, nActNumLvl, (aFmt, i) => {
    aFmt.SetNumberingType(NumberingType.CHAR_SPECIAL);
    // #i93908# clear suffix for bullet lists
    aFmt.SetListFormat('', '', i);
    aFmt.SetBulletFont(font);
    aFmt.SetBulletChar(cChar);
  });
}

/** The single numberings (getDefaultContinuousNumberingLevels), for the Ordered page. */
export const SingleNumSettings = getContinuousNumberingLevels;

/** SvxSingleNumPickTabPage::NumSelectHdl_Impl: numbering `nIdx` (0-based). */
export function SingleNumPick(pActNum: SwNumRule, nActNumLvl: number, nIdx: number): SwNumRule {
  const _pSet = getContinuousNumberingLevels()[nIdx]!;
  const eNewType = _pSet.NumberingType;
  const cLocalPrefix = _pSet.Prefix.charAt(0);
  const cLocalSuffix = _pSet.Suffix.charAt(0);
  return forLevels(pActNum, nActNumLvl, (aFmt, i) => {
    aFmt.SetNumberingType(eNewType);
    aFmt.SetListFormat(cLocalPrefix === ' ' ? '' : _pSet.Prefix, cLocalSuffix === ' ' ? '' : _pSet.Suffix, i);
  });
}

/** The outline numberings (getDefaultOutlineNumberings), for the Outline page. */
export const OutlineSettings = getOutlineNumberingLevels;

/** SvxNumPickTabPage::NumSelectHdl_Impl: outline `nIdx` (0-based); all levels are changed here. */
export function OutlinePick(pActNum: SwNumRule, nIdx: number): SwNumRule {
  const rItemArr = getOutlineNumberingLevels()[nIdx]!;
  const r = pActNum.Clone();
  let pLevelSettings = null as (typeof rItemArr)[number] | null;
  for (let i = 0; i < MAXLEVEL; i++) {
    if (rItemArr.length > i) pLevelSettings = rItemArr[i]!;
    if (!pLevelSettings) break;
    const aFmt = r.Get(i).Clone();
    aFmt.SetNumberingType(pLevelSettings.NumberingType);
    const nUpperLevelOrChar = pLevelSettings.ParentNumbering;
    if (aFmt.GetNumberingType() === NumberingType.CHAR_SPECIAL) {
      // #i93908# clear suffix for bullet lists
      aFmt.SetListFormat('', '', i);
      aFmt.SetBulletFont(pLevelSettings.BulletFontName || DEFAULT_BULLET_FONT);
      aFmt.SetBulletChar(pLevelSettings.BulletChar);
    } else {
      aFmt.SetIncludeUpperLevels(nUpperLevelOrChar !== 0 ? MAXLEVEL : 1);
      // Completely ignore the Left/Right value provided by the locale outline definition,
      // because this function doesn't actually modify the indents at all,
      // and right-adjusted numbering definitely needs a different FirstLineIndent.

      // #i93908#
      aFmt.SetListFormat(pLevelSettings.Prefix, pLevelSettings.Suffix, i);
    }
    r.Set(i, aFmt);
  }
  return r;
}

// --- SvxNumOptionsTabPage (Customize) ---

/** NumberTypeSelectHdl_Impl, with the prefix and suffix fields' text. */
export function SetNumberType(pActNum: SwNumRule, nActNumLvl: number, nNumType: NumberingType, sPrefix: string, sSuffix: string): SwNumRule {
  return forLevels(pActNum, nActNumLvl, (aNumFmt, i) => {
    aNumFmt.SetNumberingType(nNumType);
    if (nNumType === NumberingType.CHAR_SPECIAL) {
      aNumFmt.SetIncludeUpperLevels(1);
      aNumFmt.SetListFormat('', '', i);
      if (!aNumFmt.GetBulletFont()) aNumFmt.SetBulletFont(DEFAULT_BULLET_FONT);
      if (!aNumFmt.GetBulletChar()) aNumFmt.SetBulletChar(SVX_DEF_BULLET);
    } else {
      aNumFmt.SetListFormat(sPrefix, sSuffix, i);
      // CheckForStartValue_Impl: letters and Roman numbers cannot start at 0.
      const bNoZeroAllowed = nNumType < NumberingType.ARABIC || nNumType === NumberingType.CHARS_UPPER_LETTER_N || nNumType === NumberingType.CHARS_LOWER_LETTER_N;
      if (bNoZeroAllowed && aNumFmt.GetStart() === 0) aNumFmt.SetStart(1);
    }
  });
}

/** EditModifyHdl_Impl for the prefix and suffix fields. */
export const SetPrefixSuffix = (pActNum: SwNumRule, nActNumLvl: number, sPrefix: string, sSuffix: string): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt, i) => aNumFmt.SetListFormat(sPrefix, sSuffix, i));

/** EditModifyHdl_Impl for the start field. */
export const SetStart = (pActNum: SwNumRule, nActNumLvl: number, nStart: number): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => aNumFmt.SetStart(nStart));

/** AllLevelHdl_Impl: Show sublevels. */
export const SetIncludeUpperLevels = (pActNum: SwNumRule, nActNumLvl: number, n: number): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt, e) => {
    aNumFmt.SetIncludeUpperLevels(Math.min(n, e + 1));
    // Set the same prefix/suffix to generate list format with changed IncludedUpperLevels
    aNumFmt.SetListFormat(aNumFmt.GetPrefix(), aNumFmt.GetSuffix(), e);
  });

/** BulletHdl_Impl: the character chosen in the Special Characters dialog. */
export const SetBullet = (pActNum: SwNumRule, nActNumLvl: number, cChar: string, font: string | null): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => { aNumFmt.SetBulletChar(cChar); if (font) aNumFmt.SetBulletFont(font); });

// --- SvxNumPositionTabPage (Position) ---

/** EditModifyHdl_Impl: Numbering alignment. */
export const SetNumAdjust = (pActNum: SwNumRule, nActNumLvl: number, eAdjust: SvxAdjust): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => aNumFmt.SetNumAdjust(eAdjust));

/** LabelFollowedByHdl_Impl */
export const SetLabelFollowedBy = (pActNum: SwNumRule, nActNumLvl: number, e: SvxNumLabelFollowedBy): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => aNumFmt.SetLabelFollowedBy(e));

/** ListtabPosHdl_Impl */
export const SetListtabPos = (pActNum: SwNumRule, nActNumLvl: number, nValue: number): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => aNumFmt.SetListtabPos(nValue));

/** AlignAtHdl_Impl */
export const SetAlignAt = (pActNum: SwNumRule, nActNumLvl: number, nValue: number): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => aNumFmt.SetFirstLineIndent(nValue - aNumFmt.GetIndentAt()));

/** IndentAtHdl_Impl: the label stays where it is aligned. */
export const SetIndentAt = (pActNum: SwNumRule, nActNumLvl: number, nValue: number): SwNumRule =>
  forLevels(pActNum, nActNumLvl, (aNumFmt) => {
    const nAlignedAt = aNumFmt.GetIndentAt() + aNumFmt.GetFirstLineIndent();
    aNumFmt.SetIndentAt(nValue);
    aNumFmt.SetFirstLineIndent(nAlignedAt - nValue);
  });

/** StandardHdl_Impl: the positions of a new rule (LABEL_ALIGNMENT). */
export function StandardPositions(pActNum: SwNumRule, nActNumLvl: number): SwNumRule {
  const aTmpNumRule = new SwNumRule('');
  return forLevels(pActNum, nActNumLvl, (aNumFmt, i) => {
    const aTempFmt = aTmpNumRule.Get(i);
    aNumFmt.SetNumAdjust(aTempFmt.GetNumAdjust());
    aNumFmt.SetLabelFollowedBy(aTempFmt.GetLabelFollowedBy());
    aNumFmt.SetListtabPos(aTempFmt.GetListtabPos());
    aNumFmt.SetFirstLineIndent(aTempFmt.GetFirstLineIndent());
    aNumFmt.SetIndentAt(aTempFmt.GetIndentAt());
  });
}

/** The first level in the mask: the one whose values the pages show (InitControls). */
export function FirstLevel(nActNumLvl: number): number {
  for (let i = 0; i < MAXLEVEL; i++) if (nActNumLvl & (1 << i)) return i;
  return 0;
}

/** Whether all levels in the mask have the same value (InitControls' bSame… flags). */
export function SameForLevels<T>(pActNum: SwNumRule, nActNumLvl: number, get: (f: ReturnType<SwNumRule['Get']>) => T): boolean {
  const first = get(pActNum.Get(FirstLevel(nActNumLvl)));
  for (let i = 0; i < MAXLEVEL; i++) if (nActNumLvl & (1 << i) && get(pActNum.Get(i)) !== first) return false;
  return true;
}
