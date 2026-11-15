// SPDX-License-Identifier: MPL-2.0
// @upstream include/formula/grammar.hxx faithful
// @upstream formula/source/core/api/grammar.cxx faithful
// FormulaGrammar: the formula language, the address convention and the English bit packed into
// one value. The css::sheet::FormulaLanguage constants are inlined.

/** css::sheet::FormulaLanguage */
export const FormulaLanguage = { ODFF: 0, ODF_11: 1, ENGLISH: 2, NATIVE: 3, XL_ENGLISH: 4, OOXML: 5, API: 6 } as const;

const AddressConvention = {
  CONV_UNSPECIFIED: -1, /* useful when we want method to choose, must be first */
  /* elements must be sequential and changes should be reflected in ScCompiler::pCharTables */
  CONV_OOO: 0, /* 'doc'#sheet.A1:sheet2.B2 */
  CONV_ODF: 1, /* ['doc'#sheet.A1:sheet2.B2] */
  CONV_XL_A1: 2, /* [doc]sheet:sheet2!A1:B2 */
  CONV_XL_R1C1: 3, /* [doc]sheet:sheet2!R1C1:R2C2 */
  CONV_XL_OOX: 4, /* [#]sheet:sheet2!A1:B2 */
  CONV_LOTUS_A1: 5, /* external? 3d? A1.B2 <placeholder/> */
  CONV_LAST: 6, /* for loops, must always be last */
  CONV_A1_XL_A1: 7,
} as const;
type AddressConvention = (typeof AddressConvention)[keyof typeof AddressConvention];

const kConventionOffset = -AddressConvention.CONV_UNSPECIFIED + 1;
const kConventionShift = 16;
const kEnglishBit = 1 << (kConventionShift + 8);
const kFlagMask = ~(~0 << kConventionShift);

const g = (lang: number, conv: number, english: boolean) => lang | ((conv + kConventionOffset) << kConventionShift) | (english ? kEnglishBit : 0);

const Grammar = {
  GRAM_UNSPECIFIED: -1,
  GRAM_ODFF: g(FormulaLanguage.ODFF, AddressConvention.CONV_ODF, true),
  GRAM_PODF: g(FormulaLanguage.ODF_11, AddressConvention.CONV_ODF, true),
  GRAM_ENGLISH: g(FormulaLanguage.ENGLISH, AddressConvention.CONV_OOO, true),
  GRAM_NATIVE: g(FormulaLanguage.NATIVE, AddressConvention.CONV_OOO, false),
  GRAM_ODFF_UI: g(FormulaLanguage.ODFF, AddressConvention.CONV_UNSPECIFIED, true),
  GRAM_ODFF_A1: g(FormulaLanguage.ODFF, AddressConvention.CONV_OOO, true),
  GRAM_PODF_UI: g(FormulaLanguage.ODF_11, AddressConvention.CONV_UNSPECIFIED, true),
  GRAM_PODF_A1: g(FormulaLanguage.ODF_11, AddressConvention.CONV_OOO, true),
  GRAM_NATIVE_UI: g(FormulaLanguage.NATIVE, AddressConvention.CONV_UNSPECIFIED, false),
  GRAM_NATIVE_ODF: g(FormulaLanguage.NATIVE, AddressConvention.CONV_ODF, false),
  GRAM_NATIVE_XL_A1: g(FormulaLanguage.NATIVE, AddressConvention.CONV_XL_A1, false),
  GRAM_NATIVE_XL_R1C1: g(FormulaLanguage.NATIVE, AddressConvention.CONV_XL_R1C1, false),
  GRAM_ENGLISH_XL_A1: g(FormulaLanguage.XL_ENGLISH, AddressConvention.CONV_XL_A1, true),
  GRAM_ENGLISH_XL_R1C1: g(FormulaLanguage.XL_ENGLISH, AddressConvention.CONV_XL_R1C1, true),
  GRAM_ENGLISH_XL_OOX: g(FormulaLanguage.XL_ENGLISH, AddressConvention.CONV_XL_OOX, true),
  GRAM_OOXML: g(FormulaLanguage.OOXML, AddressConvention.CONV_XL_OOX, true),
  GRAM_API: g(FormulaLanguage.API, AddressConvention.CONV_OOO, true),
  GRAM_DEFAULT: g(FormulaLanguage.NATIVE, AddressConvention.CONV_UNSPECIFIED, false),
  GRAM_STORAGE_DEFAULT: g(FormulaLanguage.ODFF, AddressConvention.CONV_ODF, true),
  /** OpCodeMap set by external filter and merged with reference
      convention plus English bit on top. Plain value acts as
      FormulaLanguage. */
  GRAM_EXTERNAL: 1 << (kConventionShift - 1),
} as const;
type Grammar = number;

/** Grammars digested by ScCompiler. */
export const FormulaGrammar = {
  ...AddressConvention,
  ...Grammar,
  kConventionOffset,
  kConventionShift,
  kEnglishBit,
  kFlagMask,

  isEnglish(eGrammar: Grammar): boolean {
    return (eGrammar & kEnglishBit) !== 0;
  },

  /** Compatibility helper for old "bCompileEnglish, bCompileXML" API calls
      to obtain the new grammar. */
  mapAPItoGrammar(bEnglish: boolean, bXML: boolean): Grammar {
    let eGrammar: Grammar;
    if (bEnglish && bXML) eGrammar = Grammar.GRAM_PODF;
    else if (bEnglish && !bXML) eGrammar = Grammar.GRAM_API;
    else if (!bEnglish && bXML) eGrammar = Grammar.GRAM_NATIVE_ODF;
    else eGrammar = Grammar.GRAM_NATIVE; // (!bEnglish && !bXML)
    return eGrammar;
  },

  isSupported(eGrammar: Grammar): boolean {
    switch (eGrammar) {
      case Grammar.GRAM_ODFF:
      case Grammar.GRAM_PODF:
      case Grammar.GRAM_ENGLISH:
      case Grammar.GRAM_NATIVE:
      case Grammar.GRAM_ODFF_UI:
      case Grammar.GRAM_ODFF_A1:
      case Grammar.GRAM_PODF_UI:
      case Grammar.GRAM_PODF_A1:
      case Grammar.GRAM_NATIVE_UI:
      case Grammar.GRAM_NATIVE_ODF:
      case Grammar.GRAM_NATIVE_XL_A1:
      case Grammar.GRAM_NATIVE_XL_R1C1:
      case Grammar.GRAM_ENGLISH_XL_A1:
      case Grammar.GRAM_ENGLISH_XL_R1C1:
      case Grammar.GRAM_ENGLISH_XL_OOX:
      case Grammar.GRAM_OOXML:
      case Grammar.GRAM_API:
        return true;
      default:
        return FormulaGrammar.extractFormulaLanguage(eGrammar) === Grammar.GRAM_EXTERNAL;
    }
  },

  extractFormulaLanguage(eGrammar: Grammar): number {
    return eGrammar & kFlagMask;
  },

  extractRefConvention(eGrammar: Grammar): AddressConvention {
    return (((eGrammar & ~kEnglishBit) >> kConventionShift) - kConventionOffset) as AddressConvention;
  },

  setEnglishBit(eGrammar: Grammar, bEnglish: boolean): Grammar {
    if (bEnglish) return eGrammar | kEnglishBit;
    else return eGrammar & ~kEnglishBit;
  },

  mergeToGrammar(eGrammar: Grammar, eConv: AddressConvention): Grammar {
    const bEnglish = FormulaGrammar.isEnglish(eGrammar);
    let eGram = FormulaGrammar.extractFormulaLanguage(eGrammar) | ((eConv + kConventionOffset) << kConventionShift);
    eGram = FormulaGrammar.setEnglishBit(eGram, bEnglish);
    return eGram;
  },

  isPODF(eGrammar: Grammar): boolean {
    return FormulaGrammar.extractFormulaLanguage(eGrammar) === FormulaLanguage.ODF_11;
  },

  isODFF(eGrammar: Grammar): boolean {
    return FormulaGrammar.extractFormulaLanguage(eGrammar) === FormulaLanguage.ODFF;
  },

  isOOXML(eGrammar: Grammar): boolean {
    return FormulaGrammar.extractFormulaLanguage(eGrammar) === FormulaLanguage.OOXML;
  },

  /** If reference convention is OOXML.
      Note this is not equivalent to isOOXML() as it does not have to be
      FormulaLanguage::OOXML but can be Grammar::GRAM_EXTERNAL merged with
      AddressConvention::CONV_XL_OOX, which is used by various parts of OOXML
      import through the API FormulaParser.
   */
  isRefConventionOOXML(eGrammar: Grammar): boolean {
    return FormulaGrammar.extractRefConvention(eGrammar) === AddressConvention.CONV_XL_OOX;
  },

  isExcelSyntax(eGrammar: Grammar): boolean {
    const eConv = FormulaGrammar.extractRefConvention(eGrammar);
    switch (eConv) {
      case AddressConvention.CONV_XL_A1:
      case AddressConvention.CONV_XL_R1C1:
      case AddressConvention.CONV_XL_OOX:
        return true;
      default:
        return false;
    }
  },
};

export declare namespace FormulaGrammar {
  type AddressConvention = (typeof AddressConvention)[keyof typeof AddressConvention];
  type Grammar = number;
}
