// SPDX-License-Identifier: MPL-2.0
// @upstream include/editeng/swafopt.hxx partial
// @upstream editeng/source/misc/swafopt.cxx faithful
// The AutoFormat options. Fonts are font names (vcl::Font is not ported); the word completion
// list (m_pAutoCompleteList, only valid inside the dialog) and the smart tag manager are left out.

/** KEY_RETURN, KEY_TAB, KEY_RIGHT and KEY_END (vcl/keycodes.hxx), the keys that may accept a word completion. */
export const KEY_RETURN = 1280, KEY_SPACE = 1284, KEY_TAB = 1282, KEY_RIGHT = 1027, KEY_END = 1029;

// Class of options for AutoFormat
export class SvxSwAutoFormatFlags {
  aBulletFont = 'OpenSymbol';
  aByInputBulletFont = 'OpenSymbol';

  cBullet = '•';
  cByInputBullet = '•';

  nAutoCmpltListLen = 0;
  nAutoCmpltWordLen = 0;
  nAutoCmpltExpandKey = 0;

  nRightMargin = 0;

  bAutoCorrect = false;
  bCapitalStartSentence = false;
  bCapitalStartWord = false;

  bChgUserColl = false;
  bChgEnumNum = false;

  bAFormatByInput = false;
  bDelEmptyNode = false;
  bSetNumRule = false;
  bSetNumRuleAfterSpace = false;

  bChgOrdinalNumber = false;
  bChgToEnEmDash = false;
  bAddNonBrkSpace = false;
  bTransliterateRTL = false;
  bChgAngleQuotes = false;
  bChgWeightUnderl = false;
  bSetINetAttr = false;
  bSetDOIAttr = false;

  bSetBorder = false;
  bCreateTable = false;
  bReplaceStyles = false;
  bReplaceStylesByInput = false;

  bWithRedlining = false;

  bRightMargin = false;

  bAutoCompleteWords = false;
  bAutoCmpltCollectWords = false;
  bAutoCmpltEndless = false;
  bAutoCmpltAppendBlank = false;
  bAutoCmpltShowAsTip = false;

  bAFormatDelSpacesAtSttEnd = false;
  bAFormatDelSpacesBetweenLines = false;
  bAFormatByInpDelSpacesAtSttEnd = false;
  bAFormatByInpDelSpacesBetweenLines = false;

  bAutoCmpltKeepList = false;

  constructor() {
    this.bAutoCorrect =
    this.bCapitalStartSentence =
    this.bCapitalStartWord =
    this.bChgEnumNum =
    this.bAddNonBrkSpace =
    this.bChgOrdinalNumber =
    this.bTransliterateRTL =
    this.bChgAngleQuotes =
    this.bChgToEnEmDash =
    this.bChgWeightUnderl =
    this.bSetINetAttr =
    this.bSetDOIAttr =
    this.bAFormatDelSpacesAtSttEnd =
    this.bAFormatDelSpacesBetweenLines =
    this.bAFormatByInpDelSpacesAtSttEnd =
    this.bAFormatByInpDelSpacesBetweenLines = true;

    this.bChgUserColl =
    this.bReplaceStyles =
    this.bReplaceStylesByInput =
    this.bDelEmptyNode =
    this.bWithRedlining =
    this.bAutoCmpltEndless =
    this.bSetNumRuleAfterSpace =
    this.bAutoCmpltAppendBlank = false;

    this.bAutoCmpltShowAsTip =
    this.bSetBorder =
    this.bCreateTable =
    this.bSetNumRule =
    this.bAFormatByInput =
    this.bRightMargin =
    this.bAutoCompleteWords =
    this.bAutoCmpltCollectWords =
    this.bAutoCmpltKeepList = true;

    this.nRightMargin = 50;      // default 50%
    this.nAutoCmpltExpandKey = KEY_RETURN;

    this.cBullet = '•';
    this.cByInputBullet = this.cBullet;
    this.aByInputBulletFont = this.aBulletFont;

    this.nAutoCmpltWordLen = 8;
    this.nAutoCmpltListLen = 1000;
  }

  /** The flag members (SVX_SW_FLAG_ENTRIES). */
  static readonly FLAG_ENTRIES = [
    'bAutoCorrect', 'bCapitalStartSentence', 'bCapitalStartWord', 'bChgUserColl', 'bChgEnumNum',
    'bAFormatByInput', 'bDelEmptyNode', 'bSetNumRule', 'bSetNumRuleAfterSpace',
    'bChgOrdinalNumber', 'bChgToEnEmDash', 'bAddNonBrkSpace', 'bTransliterateRTL', 'bChgAngleQuotes',
    'bChgWeightUnderl', 'bSetINetAttr', 'bSetDOIAttr', 'bSetBorder', 'bCreateTable', 'bReplaceStyles',
    'bReplaceStylesByInput', 'bWithRedlining', 'bRightMargin', 'bAutoCompleteWords', 'bAutoCmpltCollectWords',
    'bAutoCmpltEndless', 'bAutoCmpltAppendBlank', 'bAutoCmpltShowAsTip', 'bAFormatDelSpacesAtSttEnd',
    'bAFormatDelSpacesBetweenLines', 'bAFormatByInpDelSpacesAtSttEnd', 'bAFormatByInpDelSpacesBetweenLines',
    'bAutoCmpltKeepList',
  ] as const;

  resetAllFlags(): void {
    // Set all of the flags to false
    for (const k of SvxSwAutoFormatFlags.FLAG_ENTRIES) this[k] = false;
  }

  /** The copy constructor. */
  Clone(): SvxSwAutoFormatFlags {
    return Object.assign(new SvxSwAutoFormatFlags(), this);
  }
}

export type SvxSwAutoFormatFlag = (typeof SvxSwAutoFormatFlags.FLAG_ENTRIES)[number];
