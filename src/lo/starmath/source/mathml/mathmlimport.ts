// SPDX-License-Identifier: MPL-2.0
// @upstream starmath/source/mathml/mathmlimport.cxx reduced
// @upstream starmath/source/visitors.cxx partial
// @upstream starmath/source/mathml/starmathdatabase.cxx partial
// @upstream starmath/source/mathml/mathmlattr.cxx partial
// MathML to StarMath command text, as LibreOffice's MathML import (SmXMLImport) leaves it in the
// formula: the `<annotation encoding="StarMath 5.0">` text if there is one, otherwise the text
// SmNodeToTextVisitor generates from the node tree the import contexts build.
//
// The contexts, the node stack and the visitor follow upstream statement by statement, quirks
// included (`<mfenced>` separators come out as "uoper )", `<mo>sin</mo>` as "nitalic s", content
// after the first child of <math> as further lines). The nodes keep only what the visitor reads.
// Left out: the SmDocShell / UNO model, the settings and meta streams, office:document wrappers,
// the nesting depth limit, the symbol name conversion round trip through the parser after the
// import, the SmFormat/font state of the nodes (only the generated text is wanted), and the
// MathML named entity table of the parser (`&infin;` stays literal text; numeric references and
// the XML entities are decoded by xmlparse). Font sizes are formatted from the double rather than
// from a tools Fraction. Of the visitor, only the node types the import builds are ported (no
// binom/stack tables, evaluate/abs braces, operator, binary horizontal, diagonal, special, place,
// error or vertical brace nodes).

import { childElements, parseXml, type XmlElement } from '../../../xmloff/source/core/xmlparse.ts';

const XML_NAMESPACE_MATH = 'http://www.w3.org/1998/Math/MathML';

// starmath/inc/token.hxx

/** TG: token groups (bit flags). */
const TG = {
  NONE: 0x000000, Oper: 0x000001, Relation: 0x000002, Sum: 0x000004, Product: 0x000008,
  UnOper: 0x000010, Power: 0x000020, Attribute: 0x000040, Align: 0x000080, Function: 0x000100,
  Blank: 0x000200, LBrace: 0x000400, RBrace: 0x000800, Color: 0x001000, Font: 0x002000,
  Standalone: 0x004000, Limit: 0x010000, FontAttr: 0x020000,
} as const;

/** SmTokenType: the token type names upstream uses (only those this file needs). */
type SmTokenType = string;

class SmToken {
  aText: string;
  eType: SmTokenType;
  cMathChar: string;
  nGroup: number;
  nLevel: number;

  constructor(eTokenType: SmTokenType = 'TUNKNOWN', cMath = 0, rText = '', nTokenGroup: number = TG.NONE, nTokenLevel = 0) {
    this.aText = rText;
    this.eType = eTokenType;
    this.cMathChar = String.fromCodePoint(cMath);
    this.nGroup = nTokenGroup;
    this.nLevel = nTokenLevel;
  }

  clone(): SmToken {
    const t = new SmToken(this.eType, 0, this.aText, this.nGroup, this.nLevel);
    t.cMathChar = this.cMathChar;
    return t;
  }

  /** operator=(const SmColorTokenTableEntry&) */
  assignColor(rEntry: SmColorTokenTableEntry): void {
    this.aText = '';
    this.eType = rEntry.eType;
    this.cMathChar = (rEntry.cColor >>> 0).toString(16);
    this.nGroup = TG.Color;
    this.nLevel = 0;
  }

  setChar(c: number | string): void {
    this.cMathChar = typeof c === 'number' ? String.fromCodePoint(c) : c;
  }
}

/** cMathChar[0]: an empty OUString yields its terminating 0. */
const char0 = (s: string): number => (s.length ? s.charCodeAt(0) : 0);

// starmath/inc/types.hxx (the characters used below)
const MS_NONE = 0x0000, MS_FACT = 0x0021, MS_INFINITY = 0x221E, MS_SLASH = 0x002F, MS_NDIVIDES = 0x2224;
const MS_DRARROW = 0x21D2, MS_DLARROW = 0x21D0, MS_DLRARROW = 0x21D4, MS_CIRC = 0x2218, MS_ASSIGN = 0x003D;
const MS_NEQ = 0x2260, MS_PLUS = 0x002B, MS_MINUS = 0x2212, MS_MULTIPLY = 0x2217, MS_TIMES = 0x00D7;
const MS_CDOT = 0x22C5, MS_DIV = 0x00F7, MS_PLUSMINUS = 0x00B1, MS_MINUSPLUS = 0x2213, MS_OPLUS = 0x2295;
const MS_OMINUS = 0x2296, MS_OTIMES = 0x2297, MS_ODIVIDE = 0x2298, MS_ODOT = 0x2299, MS_UNION = 0x222A;
const MS_INTERSECT = 0x2229, MS_LT = 0x003C, MS_GT = 0x003E, MS_LE = 0x2264, MS_GE = 0x2265;
const MS_LESLANT = 0x2A7D, MS_GESLANT = 0x2A7E, MS_LL = 0x226A, MS_GG = 0x226B, MS_SIM = 0x223C;
const MS_SIMEQ = 0x2243, MS_DEF = 0x225D, MS_EQUIV = 0x2261, MS_PROP = 0x221D, MS_PARTIAL = 0x2202;
const MS_LAPLACE = 0x2112, MS_SUBSET = 0x2282, MS_SUPSET = 0x2283, MS_SUBSETEQ = 0x2286, MS_SUPSETEQ = 0x2287;
const MS_NSUBSET = 0x2284, MS_NSUPSET = 0x2285, MS_NSUBSETEQ = 0x2288, MS_NSUPSETEQ = 0x2289, MS_IN = 0x2208;
const MS_NOTIN = 0x2209, MS_EXISTS = 0x2203, MS_NOTEXISTS = 0x2204, MS_BACKEPSILON = 0x220D, MS_ALEPH = 0x2135;
const MS_IM = 0x2111, MS_RE = 0x211C, MS_WP = 0x2118, MS_LINE = 0x2223, MS_VERTLINE = 0x007C, MS_DLINE = 0x2225;
const MS_DVERTLINE = 0x2016, MS_ORTHO = 0x22A5, MS_DOTSLOW = 0x2026, MS_DOTSAXIS = 0x22EF, MS_DOTSVERT = 0x22EE;
const MS_DOTSUP = 0x22F0, MS_DOTSDOWN = 0x22F1, MS_TRANSR = 0x22B6, MS_TRANSL = 0x22B7, MS_BACKSLASH = 0x2216;
const MS_NEG = 0x00AC, MS_FORALL = 0x2200, MS_NABLA = 0x2207, MS_PROD = 0x220F, MS_COPROD = 0x2210, MS_SUM = 0x2211;
const MS_MAJ = 0x1EEF0, MS_SQRT = 0x221A, MS_INT = 0x222B, MS_IINT = 0x222C, MS_IIINT = 0x222D, MS_LINT = 0x222E;
const MS_LLINT = 0x222F, MS_LLLINT = 0x2230, MS_TILDE = 0x007E, MS_AND = 0x2227, MS_OR = 0x2228, MS_NI = 0x220B;
const MS_EMPTYSET = 0x2205, MS_LPARENT = 0x0028, MS_RPARENT = 0x0029, MS_LBRACKET = 0x005B, MS_RBRACKET = 0x005D;
const MS_LBRACE = 0x007B, MS_RBRACE = 0x007D, MS_LCEIL = 0x2308, MS_RCEIL = 0x2309, MS_LFLOOR = 0x230A;
const MS_RFLOOR = 0x230B, MS_LANGLE = 0x2329, MS_RANGLE = 0x232A, MS_LDBRACKET = 0x27E6, MS_RDBRACKET = 0x27E7;
const MS_LMATHANGLE = 0x27E8, MS_RMATHANGLE = 0x27E9, MS_LAMBDABAR = 0x019B, MS_HBAR = 0x210F;
const MS_LEFTARROW = 0x2190, MS_UPARROW = 0x2191, MS_RIGHTARROW = 0x2192, MS_DOWNARROW = 0x2193;
const MS_SETN = 0x2115, MS_SETZ = 0x2124, MS_SETQ = 0x211A, MS_SETR = 0x211D, MS_SETC = 0x2102;
const MS_PRECEDES = 0x227A, MS_PRECEDESEQUAL = 0x227C, MS_PRECEDESEQUIV = 0x227E, MS_SUCCEEDS = 0x227B;
const MS_SUCCEEDSEQUAL = 0x227D, MS_SUCCEEDSEQUIV = 0x227F, MS_NOTPRECEDES = 0x2280, MS_NOTSUCCEEDS = 0x2281;

// starmath/source/mathml/starmathdatabase.cxx

type TokenRow = [SmTokenType, number, string, number, number];
const tok = (r: TokenRow): SmToken => new SmToken(r[0], r[1], r[2], r[3], r[4]);
const ERROR_TOKEN: TokenRow = ['TERROR', MS_NONE, '', TG.NONE, 0xFFFF];

// The brace entries Identify_Prefix/Postfix/PrefixPostfix share (and Identify_SmXMLOperatorContext_Impl
// has, except for the vertical lines).
const BRACES: [number, TokenRow][] = [
  [MS_LANGLE, ['TLANGLE', MS_LMATHANGLE, 'langle', TG.LBrace, 5]],
  [MS_LMATHANGLE, ['TLANGLE', MS_LMATHANGLE, 'langle', TG.LBrace, 5]],
  [MS_LBRACE, ['TLBRACE', MS_LBRACE, 'lbrace', TG.LBrace, 5]],
  [MS_LCEIL, ['TLCEIL', MS_LCEIL, 'lceil', TG.LBrace, 5]],
  [MS_LFLOOR, ['TLFLOOR', MS_LFLOOR, 'lfloor', TG.LBrace, 5]],
  [MS_LDBRACKET, ['TLDBRACKET', MS_LDBRACKET, 'ldbracket', TG.LBrace, 5]],
  [MS_LBRACKET, ['TLBRACKET', MS_LBRACKET, '[', TG.LBrace, 5]],
  [MS_LPARENT, ['TLPARENT', MS_LPARENT, '(', TG.LBrace, 5]],
  [MS_RANGLE, ['TRANGLE', MS_RMATHANGLE, 'rangle', TG.RBrace, 5]],
  [MS_RMATHANGLE, ['TRANGLE', MS_RMATHANGLE, 'rangle', TG.RBrace, 5]],
  [MS_RBRACE, ['TRBRACE', MS_RBRACE, 'rbrace', TG.RBrace, 5]],
  [MS_RCEIL, ['TRCEIL', MS_RCEIL, 'rceil', TG.RBrace, 5]],
  [MS_RFLOOR, ['TRFLOOR', MS_RFLOOR, 'rfloor', TG.RBrace, 5]],
  [MS_RDBRACKET, ['TRDBRACKET', MS_RDBRACKET, 'rdbracket', TG.RBrace, 5]],
  [MS_RBRACKET, ['TRBRACKET', MS_RBRACKET, ']', TG.RBrace, 5]],
  [MS_RPARENT, ['TRPARENT', MS_RPARENT, ')', TG.RBrace, 5]],
  [MS_NONE, ['TNONE', MS_NONE, 'none', TG.RBrace | TG.LBrace, 5]],
];

const aOperatorTable = new Map<number, TokenRow>([
  [MS_COPROD, ['TCOPROD', MS_COPROD, 'coprod', TG.Oper, 5]],
  [MS_IIINT, ['TIIINT', MS_IIINT, 'iiint', TG.Oper, 5]],
  [MS_IINT, ['TIINT', MS_IINT, 'iint', TG.Oper, 5]],
  [MS_INT, ['TINT', MS_INT, 'int', TG.Oper, 5]],
  [MS_LINT, ['TLINT', MS_LINT, 'lint', TG.Oper, 5]],
  [MS_LLINT, ['TLLINT', MS_LLINT, 'llint', TG.Oper, 5]],
  [MS_LLLINT, ['TLLLINT', MS_LLLINT, 'lllint', TG.Oper, 5]],
  [MS_PROD, ['TPROD', MS_PROD, 'prod', TG.Oper, 5]],
  [MS_SUM, ['TSUM', MS_SUM, 'sum', TG.Oper, 5]],
  [MS_MAJ, ['TSUM', MS_MAJ, 'maj', TG.Oper, 5]],
  [MS_FACT, ['TFACT', MS_FACT, '!', TG.UnOper, 5]],
  [MS_NEG, ['TNEG', MS_NEG, 'neg', TG.UnOper, 5]],
  [MS_OMINUS, ['TOMINUS', MS_OMINUS, 'ominus', TG.Sum, 0]],
  [MS_OPLUS, ['TOPLUS', MS_OPLUS, 'oplus', TG.Sum, 0]],
  [MS_UNION, ['TUNION', MS_UNION, 'union', TG.Sum, 0]],
  [MS_OR, ['TOR', MS_OR, '|', TG.Sum, 5]],
  [MS_PLUSMINUS, ['TPLUSMINUS', MS_PLUSMINUS, '+-', TG.Sum | TG.UnOper, 5]],
  [MS_MINUSPLUS, ['TMINUSPLUS', MS_MINUSPLUS, '-+', TG.Sum | TG.UnOper, 5]],
  [0xe083, ['TPLUS', MS_PLUS, '+', TG.Sum | TG.UnOper, 5]],
  [MS_PLUS, ['TPLUS', MS_PLUS, '+', TG.Sum | TG.UnOper, 5]],
  [MS_MINUS, ['TMINUS', MS_MINUS, '-', TG.Sum | TG.UnOper, 5]],
  [0x2022, ['TCDOT', MS_CDOT, 'cdot', TG.Product, 0]],
  [MS_CDOT, ['TCDOT', MS_CDOT, 'cdot', TG.Product, 0]],
  [MS_DIV, ['TDIV', MS_DIV, 'div', TG.Product, 0]],
  [MS_TIMES, ['TTIMES', MS_TIMES, 'times', TG.Product, 0]],
  [MS_INTERSECT, ['TINTERSECT', MS_INTERSECT, 'intersection', TG.Product, 0]],
  [MS_ODIVIDE, ['TODIVIDE', MS_ODIVIDE, 'odivide', TG.Product, 0]],
  [MS_ODOT, ['TODOT', MS_ODOT, 'odot', TG.Product, 0]],
  [MS_OTIMES, ['TOTIMES', MS_OTIMES, 'otimes', TG.Product, 0]],
  [MS_AND, ['TAND', MS_AND, '&', TG.Product, 0]],
  [MS_MULTIPLY, ['TMULTIPLY', MS_MULTIPLY, '*', TG.Product, 0]],
  [MS_SLASH, ['TSLASH', MS_SLASH, 'slash', TG.Product, 0]],
  [MS_BACKSLASH, ['TBACKSLASH', MS_BACKSLASH, 'bslash', TG.Product, 0]],
  [MS_DEF, ['TDEF', MS_DEF, 'def', TG.Relation, 0]],
  [MS_LINE, ['TDIVIDES', MS_LINE, 'divides', TG.Relation, 0]],
  [MS_EQUIV, ['TEQUIV', MS_EQUIV, 'equiv', TG.Relation, 0]],
  [MS_GE, ['TGE', MS_GE, '>=', TG.Relation, 0]],
  [MS_GESLANT, ['TGESLANT', MS_GESLANT, 'geslant', TG.Relation, 0]],
  [MS_GG, ['TGG', MS_GG, '>>', TG.Relation, 0]],
  [MS_GT, ['TGT', MS_GT, '>', TG.Relation, 0]],
  [MS_IN, ['TIN', MS_IN, 'in', TG.Relation, 0]],
  [MS_LE, ['TLE', MS_LE, '<=', TG.Relation, 0]],
  [MS_LESLANT, ['TLESLANT', MS_LESLANT, 'leslant', TG.Relation, 0]],
  [MS_LL, ['TLL', MS_LL, '<<', TG.Relation, 0]],
  [MS_LT, ['TLT', MS_LT, '<', TG.Relation, 0]],
  [MS_NDIVIDES, ['TNDIVIDES', MS_NDIVIDES, 'ndivides', TG.Relation, 0]],
  [MS_NEQ, ['TNEQ', MS_NEQ, '<>', TG.Relation, 0]],
  [MS_NOTIN, ['TNOTIN', MS_NOTIN, 'notin', TG.Relation, 0]],
  [MS_NOTPRECEDES, ['TNOTPRECEDES', MS_NOTPRECEDES, 'nprec', TG.Relation, 0]],
  [MS_NSUBSET, ['TNSUBSET', MS_NSUBSET, 'nsubset', TG.Relation, 0]],
  [MS_NSUBSETEQ, ['TNSUBSETEQ', MS_NSUBSETEQ, 'nsubseteq', TG.Relation, 0]],
  [MS_NOTSUCCEEDS, ['TNOTSUCCEEDS', MS_NOTSUCCEEDS, 'nsucc', TG.Relation, 0]],
  [MS_NSUPSET, ['TNSUPSET', MS_NSUPSET, 'nsupset', TG.Relation, 0]],
  [MS_NSUPSETEQ, ['TNSUPSETEQ', MS_NSUPSETEQ, 'nsupseteq', TG.Relation, 0]],
  [MS_ORTHO, ['TORTHO', MS_ORTHO, 'ortho', TG.Relation, 0]],
  [MS_NI, ['TNI', MS_NI, 'owns', TG.Relation, 0]],
  [MS_DLINE, ['TPARALLEL', MS_DLINE, 'parallel', TG.Relation, 0]],
  [MS_PRECEDES, ['TPRECEDES', MS_PRECEDES, 'prec', TG.Relation, 0]],
  [MS_PRECEDESEQUAL, ['TPRECEDESEQUAL', MS_PRECEDESEQUAL, 'preccurlyeq', TG.Relation, 0]],
  [MS_PRECEDESEQUIV, ['TPRECEDESEQUIV', MS_PRECEDESEQUIV, 'precsim', TG.Relation, 0]],
  [MS_PROP, ['TPROP', MS_PROP, 'prop', TG.Relation, 0]],
  [MS_SIM, ['TSIM', MS_SIM, 'sim', TG.Relation, 0]],
  [0x2245, ['TSIMEQ', MS_SIMEQ, 'simeq', TG.Relation, 0]],
  [MS_SIMEQ, ['TSIMEQ', MS_SIMEQ, 'simeq', TG.Relation, 0]],
  [MS_SUBSET, ['TSUBSET', MS_SUBSET, 'subset', TG.Relation, 0]],
  [MS_SUBSETEQ, ['TSUBSETEQ', MS_SUBSETEQ, 'subseteq', TG.Relation, 0]],
  [MS_SUCCEEDS, ['TSUCCEEDS', MS_SUCCEEDS, 'succ', TG.Relation, 0]],
  [MS_SUCCEEDSEQUAL, ['TSUCCEEDSEQUAL', MS_SUCCEEDSEQUAL, 'succcurlyeq', TG.Relation, 0]],
  [MS_SUCCEEDSEQUIV, ['TSUCCEEDSEQUIV', MS_SUCCEEDSEQUIV, 'succsim', TG.Relation, 0]],
  [MS_SUPSET, ['TSUPSET', MS_SUPSET, 'supset', TG.Relation, 0]],
  [MS_SUPSETEQ, ['TSUPSETEQ', MS_SUPSETEQ, 'supseteq', TG.Relation, 0]],
  [MS_RIGHTARROW, ['TTOWARD', MS_RIGHTARROW, 'toward', TG.Relation, 0]],
  [MS_TRANSL, ['TTRANSL', MS_TRANSL, 'transl', TG.Relation, 0]],
  [MS_TRANSR, ['TTRANSR', MS_TRANSR, 'transr', TG.Relation, 0]],
  [MS_ASSIGN, ['TASSIGN', MS_ASSIGN, '=', TG.Relation, 0]],
  ...BRACES,
]);

const aPrefixTable = new Map<number, TokenRow>([
  [MS_VERTLINE, ['TLLINE', MS_VERTLINE, 'lline', TG.LBrace, 5]],
  [MS_DVERTLINE, ['TLDLINE', MS_DVERTLINE, 'ldline', TG.LBrace, 5]],
  ...BRACES,
]);
const aPostfixTable = new Map<number, TokenRow>([
  [MS_VERTLINE, ['TRLINE', MS_VERTLINE, 'rline', TG.RBrace, 5]],
  [MS_DVERTLINE, ['TRDLINE', MS_DVERTLINE, 'rdline', TG.RBrace, 5]],
  ...BRACES,
]);
const aPrefixPostfixTable = new Map<number, TokenRow>([
  [MS_VERTLINE, ['TLRLINE', MS_VERTLINE, 'lrline', TG.LBrace | TG.RBrace, 5]],
  [MS_DVERTLINE, ['TLRDLINE', MS_DVERTLINE, 'lrdline', TG.LBrace | TG.RBrace, 5]],
  ...BRACES,
]);

const firstCodePoint = (rText: string): number => rText.codePointAt(0) ?? 0;

const starmathdatabase = {
  Identify_SmXMLOperatorContext_Impl(rText: string, bIsStretchy = false): SmToken {
    const cChar = firstCodePoint(rText);
    switch (cChar) {
      case MS_INT:
        if (bIsStretchy) return new SmToken('TINTD', MS_INT, 'intd', TG.Oper, 5);
        else return new SmToken('TINT', MS_INT, 'int', TG.Oper, 5);
      case MS_SLASH:
        if (bIsStretchy) return new SmToken('TWIDESLASH', MS_SLASH, 'wideslash', TG.Product, 0);
        else return new SmToken('TSLASH', MS_SLASH, 'slash', TG.Product, 0);
      case MS_BACKSLASH:
        if (bIsStretchy) return new SmToken('TWIDEBACKSLASH', MS_BACKSLASH, 'widebslash', TG.Product, 0);
        else return new SmToken('TBACKSLASH', MS_BACKSLASH, 'bslash', TG.Product, 0);
    }
    return tok(aOperatorTable.get(cChar) ?? ERROR_TOKEN);
  },
  Identify_Prefix_SmXMLOperatorContext_Impl(rText: string): SmToken {
    return tok(aPrefixTable.get(firstCodePoint(rText)) ?? ERROR_TOKEN);
  },
  Identify_Postfix_SmXMLOperatorContext_Impl(rText: string): SmToken {
    return tok(aPostfixTable.get(firstCodePoint(rText)) ?? ERROR_TOKEN);
  },
  Identify_PrefixPostfix_SmXMLOperatorContext_Impl(rText: string): SmToken {
    return tok(aPrefixPostfixTable.get(firstCodePoint(rText)) ?? ERROR_TOKEN);
  },
  Identify_Color_Parser(cColor: number): SmColorTokenTableEntry {
    for (const i of aColorTokenTableParse) if (i.cColor === cColor) return i;
    for (const i of aColorTokenTableDVIPS) if (i.cColor === cColor) return i;
    if ((cColor & 0x00FFFFFF) === cColor) return { aIdent: '', eType: 'TRGB', cColor };
    else return { aIdent: '', eType: 'TRGBA', cColor };
  },
  Identify_ColorName_HTML(colorname: string): SmColorTokenTableEntry {
    if (!colorname) return { aIdent: '', eType: 'TERROR', cColor: 0x000000 };
    if (colorname[0] === '#') {
      const col = STRtoRGB(colorname);
      return { aIdent: '', eType: 'TRGB', cColor: col };
    }
    const lower = colorname.replace(/[A-Z]/g, (c) => c.toLowerCase());
    for (const i of aColorTokenTableParse) {
      if ((i.eType === 'THTMLCOL' || i.eType === 'TMATHMLCOL') && i.aIdent === lower) return i;
    }
    return { aIdent: '', eType: 'TERROR', cColor: 0x000000 };
  },
};

interface SmColorTokenTableEntry { aIdent: string; eType: SmTokenType; cColor: number }

const COLOR_TYPE: Record<string, SmTokenType> = {
  h: 'THTMLCOL', m: 'TMATHMLCOL', i: 'TICONICCOL', d: 'TDVIPSNAMESCOL', x: 'THEX', r: 'TRGB', a: 'TRGBA',
};
const colorTable = (s: string): SmColorTokenTableEntry[] =>
  s.trim().split(/\s+/).map((e) => {
    const [aIdent, t, c] = e.split(':') as [string, string, string];
    return { aIdent, eType: COLOR_TYPE[t]!, cColor: parseInt(c, 16) };
  });
// aColorTokenTableParse in its order (Identify_Color_Parser returns the first entry of a colour);
// the THTMLCOL and TMATHMLCOL entries are exactly aColorTokenTableHTML.
const aColorTokenTableParse = colorTable(
  'aliceblue:h:f0f8ff antiquewhite:h:faebd7 aqua:m:00ffff aquamarine:h:7fffd4 azure:h:f0ffff ' +
  'beige:h:f5f5dc bisque:h:ffe4c4 black:m:000000 blanchedalmond:h:ffebcd blue:m:0000ff ' +
  'blueviolet:h:8a2be2 brown:h:a52a2a burlywood:h:deb887 cadetblue:h:5f9ea0 chartreuse:h:7fff00 ' +
  'chocolate:h:d2691e coral:h:ff7f50 cornflowerblue:h:6495ed cornsilk:h:fff8dc crimson:h:dc143c ' +
  'cyan:m:00ffff darkblue:h:00008b darkcyan:h:008b8b darkgoldenrod:h:b8860b darkgray:h:a9a9a9 ' +
  'darkgreen:h:006400 darkgrey:h:a9a9a9 darkkhaki:h:bdb76b darkmagenta:h:8b008b darkolivegreen:h:556b2f ' +
  'darkorange:h:ff8c00 darkorchid:h:9932cc darkred:h:8b0000 darksalmon:h:e9967a darkseagreen:h:8fbc8f ' +
  'darkslateblue:h:483d8b darkslategray:h:2f4f4f darkslategrey:h:2f4f4f darkturquoise:h:00ced1 ' +
  'darkviolet:h:9400d3 debian:i:a80030 deeppink:h:ff1493 deepskyblue:h:00bfff dimgray:h:696969 ' +
  'dimgrey:h:696969 dodgerblue:h:1e90ff dvip:d:000000 firebrick:h:b22222 floralwhite:h:fffaf0 ' +
  'forestgreen:h:228b22 fuchsia:m:ff00ff gainsboro:h:dcdcdc ghostwhite:h:f8f8ff gold:h:ffd700 ' +
  'goldenrod:h:daa520 gray:m:808080 green:m:008000 greenyellow:h:adff2f grey:h:808080 hex:x:000000 ' +
  'honeydew:h:f0fff0 hotpink:h:ff69b4 indianred:h:cd5c5c indigo:h:4b0082 ivory:h:fffff0 khaki:h:f0e68c ' +
  'lavender:h:e6e6fa lavenderblush:h:fff0f5 lawngreen:h:7cfc00 lemonchiffon:h:fffacd lightblue:h:add8e6 ' +
  'lightcoral:h:f08080 lightcyan:h:e0ffff lightgoldenrodyellow:h:fafad2 lightgray:h:d3d3d3 ' +
  'lightgreen:h:90ee90 lightgrey:h:d3d3d3 lightpink:h:ffb6c1 lightsalmon:h:ffa07a ' +
  'lightseagreen:h:20b2aa lightskyblue:h:87cefa lightslategray:h:778899 lightslategrey:h:778899 ' +
  'lightsteelblue:h:b0c4de lightyellow:h:ffffe0 lime:m:00ff00 limegreen:h:32cd32 linen:h:faf0e6 ' +
  'lo:i:00a500 magenta:m:ff00ff maroon:m:800000 mediumaquamarine:h:66cdaa mediumblue:h:0000cd ' +
  'mediumorchid:h:ba55d3 mediumpurple:h:9370db mediumseagreen:h:3cb371 mediumslateblue:h:7b68ee ' +
  'mediumspringgreen:h:00fa9a mediumturquoise:h:48d1cc mediumvioletred:h:c71585 midnightblue:h:191970 ' +
  'mintcream:h:f5fffa mistyrose:h:ffe4e1 moccasin:h:ffe4b5 navajowhite:h:ffdead navy:m:000080 ' +
  'oldlace:h:fdf5e6 olive:m:808000 olivedrab:h:6b8e23 orange:h:ffa500 orangered:h:ff4500 ' +
  'orchid:h:da70d6 palegoldenrod:h:eee8aa palegreen:h:98fb98 paleturquoise:h:afeeee ' +
  'palevioletred:h:db7093 papayawhip:h:ffefd5 peachpuff:h:ffdab9 peru:h:cd853f pink:h:ffc0cb ' +
  'plum:h:dda0dd powderblue:h:b0e0e6 purple:m:800080 rebeccapurple:h:663399 red:m:ff0000 rgb:r:ffffffff ' +
  'rgba:a:ffffffff rosybrown:h:bc8f8f royalblue:h:4169e1 saddlebrown:h:8b4513 salmon:h:fa8072 ' +
  'sandybrown:h:f4a460 seagreen:h:2e8b57 seashell:h:fff5ee sienna:h:a0522d silver:m:c0c0c0 ' +
  'skyblue:h:87ceeb slateblue:h:6a5acd slategray:h:708090 slategrey:h:708090 snow:h:fffafa ' +
  'springgreen:h:00ff7f steelblue:h:4682b4 tan:h:d2b48c teal:m:008080 thistle:h:d8bfd8 tomato:h:ff6347 ' +
  'turquoise:h:40e0d0 ubuntu:i:e95420 violet:h:ee82ee wheat:h:f5deb3 white:m:ffffff whitesmoke:h:f5f5f5 ' +
  'yellow:m:ffff00 yellowgreen:h:9acd32',
);
const aColorTokenTableDVIPS = colorTable(
  'apricot:d:ffb781 aquamarine:d:1bbec1 bittersweet:d:cf4b16 black:d:000000 blue:d:000000',
);

/** tools Color::STRtoRGB */
function STRtoRGB(colorname: string): number {
  const hex = (s: string): number => {
    const m = /^[0-9a-fA-F]*/.exec(s)![0];
    return m ? parseInt(m, 16) : 0;
  };
  const c = colorname;
  switch (c.length) {
    case 7: return hex(c.slice(1, 7));
    case 6: return hex(c);
    case 4: return hex(c[1]! + c[1] + c[2] + c[2] + c[3] + c[3]);
    case 3: return hex(c[0]! + c[0] + c[1] + c[1] + c[2] + c[2]);
    default: return 0;
  }
}

// starmath/source/mathml/mathmlattr.cxx

const MathMLLengthUnit = { None: 0, Em: 1, Ex: 2, Px: 3, In: 4, Cm: 5, Mm: 6, Pt: 7, Pc: 8, Percent: 9 } as const;
interface MathMLAttributeLengthValue { aNumber: number; eUnit: number }

function ParseMathMLUnsignedNumber(rStr: string): { nIdx: number; rUN: number } | null {
  const nLen = rStr.length;
  let nDecimalPoint = -1;
  let nIdx: number;
  for (nIdx = 0; nIdx < nLen; nIdx++) {
    const cD = rStr[nIdx]!;
    if (cD === '.') {
      if (nDecimalPoint !== -1) return null;
      nDecimalPoint = nIdx;
      continue;
    }
    if (cD < '0' || '9' < cD) break;
  }
  if (nIdx === 0 || (nIdx === 1 && nDecimalPoint === 0)) return null;
  return { nIdx, rUN: parseFloat(rStr.slice(0, nIdx)) };
}

function ParseMathMLNumber(rStr: string): { nIdx: number; rN: number } | null {
  if (!rStr) return null;
  const bNegative = rStr[0] === '-';
  const nOffset = bNegative ? 1 : 0;
  const r = ParseMathMLUnsignedNumber(rStr.slice(nOffset));
  if (!r || !Number.isFinite(r.rUN)) return null;
  return { nIdx: nOffset + r.nIdx, rN: bNegative ? -r.rUN : r.rUN };
}

function ParseMathMLAttributeLengthValue(rStr: string, rV: MathMLAttributeLengthValue): boolean {
  const r = ParseMathMLNumber(rStr);
  if (!r) return false;
  rV.aNumber = r.rN;
  const sRest = rStr.slice(r.nIdx);
  if (!sRest) rV.eUnit = MathMLLengthUnit.None;
  if (sRest.startsWith('em')) rV.eUnit = MathMLLengthUnit.Em;
  if (sRest.startsWith('ex')) rV.eUnit = MathMLLengthUnit.Ex;
  if (sRest.startsWith('px')) rV.eUnit = MathMLLengthUnit.Px;
  if (sRest.startsWith('in')) rV.eUnit = MathMLLengthUnit.In;
  if (sRest.startsWith('cm')) rV.eUnit = MathMLLengthUnit.Cm;
  if (sRest.startsWith('mm')) rV.eUnit = MathMLLengthUnit.Mm;
  if (sRest.startsWith('pt')) rV.eUnit = MathMLLengthUnit.Pt;
  if (sRest.startsWith('pc')) rV.eUnit = MathMLLengthUnit.Pc;
  if (sRest[0] === '%') rV.eUnit = MathMLLengthUnit.Percent;
  return true;
}

const MathMLMathvariantValue = {
  Normal: 'normal', Bold: 'bold', Italic: 'italic', BoldItalic: 'bold-italic', DoubleStruck: 'double-struck',
  BoldFraktur: 'bold-fraktur', Script: 'script', BoldScript: 'bold-script', Fraktur: 'fraktur',
  SansSerif: 'sans-serif', BoldSansSerif: 'bold-sans-serif', SansSerifItalic: 'sans-serif-italic',
  SansSerifBoldItalic: 'sans-serif-bold-italic', Monospace: 'monospace', Initial: 'initial', Tailed: 'tailed',
  Looped: 'looped', Stretched: 'stretched',
} as const;
type MathMLMathvariantValue = (typeof MathMLMathvariantValue)[keyof typeof MathMLMathvariantValue];
const aMathvariantValues = new Set<string>(Object.values(MathMLMathvariantValue));

// starmath/inc/node.hxx: the node tree, reduced to what SmNodeToTextVisitor reads.

const SmNodeType = {
  Table: 'Table', Brace: 'Brace', Attribute: 'Attribute', Font: 'Font', BinVer: 'BinVer', SubSup: 'SubSup',
  Matrix: 'Matrix', Text: 'Text', GlyphSpecial: 'GlyphSpecial', Math: 'Math', Blank: 'Blank', Line: 'Line',
  Expression: 'Expression', Root: 'Root', RootSymbol: 'RootSymbol', Rectangle: 'Rectangle',
} as const;
type SmNodeType = (typeof SmNodeType)[keyof typeof SmNodeType];

const SmScaleMode = { None: 0, Width: 1, Height: 2 } as const;
const FontSizeType = { ABSOLUT: 1, PLUS: 2, MINUS: 3, MULTIPLY: 4, DIVIDE: 5 } as const;

// SmSubSup
const CSUB = 0, CSUP = 1, RSUB = 2, RSUP = 3, LSUB = 4, LSUP = 5;
const SUBSUP_NUM_ENTRIES = 6;

class SmNode {
  meType: SmNodeType;
  maNodeToken: SmToken;
  mpParentNode: SmNode | null = null;
  meScaleMode: number = SmScaleMode.None;
  maSubNodes: (SmNode | null)[] = [];
  // SmFontNode
  meSizeType: number = FontSizeType.MULTIPLY;
  maFontSize = 1;
  // SmBlankNode
  mnNum = 0;
  // SmSubSupNode
  mbUseLimits = false;
  // SmMatrixNode
  mnNumRows = 0;
  mnNumCols = 0;

  constructor(eNodeType: SmNodeType, rNodeToken: SmToken) {
    this.meType = eNodeType;
    this.maNodeToken = rNodeToken.clone();
  }

  GetType(): SmNodeType { return this.meType; }
  GetToken(): SmToken { return this.maNodeToken; }
  GetParent(): SmNode | null { return this.mpParentNode; }
  GetScaleMode(): number { return this.meScaleMode; }
  SetScaleMode(eMode: number): void { this.meScaleMode = eMode; }
  GetNumSubNodes(): number { return this.maSubNodes.length; }
  GetSubNode(nIndex: number): SmNode | null { return nIndex < this.maSubNodes.length ? this.maSubNodes[nIndex]! : null; }
  Accept(pVisitor: SmNodeToTextVisitor): void { pVisitor.Visit(this); }

  /** SmStructureNode::SetSubNodes: three nodes (trailing null ones dropped) or an array. */
  SetSubNodes(pFirst: SmNode | null | (SmNode | null)[], pSecond: SmNode | null = null, pThird: SmNode | null = null): void {
    if (Array.isArray(pFirst)) this.maSubNodes = pFirst;
    else {
      const nSize = pThird ? 3 : pSecond ? 2 : pFirst ? 1 : 0;
      this.maSubNodes = [pFirst, pSecond, pThird].slice(0, nSize);
    }
    this.ClaimPaternity();
  }
  ClearSubNodes(): void { this.maSubNodes = []; }
  ClaimPaternity(): void {
    for (const pNode of this.maSubNodes) if (pNode) pNode.mpParentNode = this;
  }

  // SmFontNode
  SetSizeParameter(rValue: number, eType: number): void { this.meSizeType = eType; this.maFontSize = rValue; }
  GetSizeType(): number { return this.meSizeType; }
  GetSizeParameter(): number { return this.maFontSize; }
  // SmBlankNode
  IncreaseBy(rToken: SmToken, nMultiplyBy: number): void {
    switch (rToken.eType) {
      case 'TBLANK': this.mnNum += 4 * nMultiplyBy; break;
      case 'TSBLANK': this.mnNum += 1 * nMultiplyBy; break;
      default: break;
    }
  }
  GetBlankNum(): number { return this.mnNum; }
  // SmSubSupNode
  GetBody(): SmNode | null { return this.GetSubNode(0); }
  GetSubSup(eSubSup: number): SmNode | null { return this.GetSubNode(1 + eSubSup); }
  IsUseLimits(): boolean { return this.mbUseLimits; }
  // SmMatrixNode
  SetRowCol(nMatrixRows: number, nMatrixCols: number): void { this.mnNumRows = nMatrixRows; this.mnNumCols = nMatrixCols; }
  GetNumRows(): number { return this.mnNumRows; }
  GetNumCols(): number { return this.mnNumCols; }
}

const SubSupNode = (rToken: SmToken): SmNode => {
  const p = new SmNode(SmNodeType.SubSup, rToken);
  p.maSubNodes = new Array<SmNode | null>(1 + SUBSUP_NUM_ENTRIES).fill(null);
  return p;
};

// starmath/source/visitors.cxx: SmNodeToTextVisitor

class SmNodeToTextVisitor {
  private maCmdText = '';

  constructor(pNode: SmNode) {
    pNode.Accept(this);
    this.maCmdText = this.maCmdText.replace(/ +$/, '');
  }

  GetText(): string { return this.maCmdText; }

  Visit(pNode: SmNode): void {
    switch (pNode.GetType()) {
      case SmNodeType.Table: {
        //Assume it's a toplevel table, containing lines
        let bFirst = true;
        for (const pChild of pNode.maSubNodes) {
          if (!pChild) continue;
          if (bFirst) bFirst = false;
          else {
            this.Separate();
            this.Append('newline');
          }
          this.Separate();
          pChild.Accept(this);
        }
        break;
      }
      case SmNodeType.Brace: {
        const pLeftBrace = pNode.GetSubNode(0), pBody = pNode.GetSubNode(1), pRightBrace = pNode.GetSubNode(2);
        if (pNode.GetScaleMode() === SmScaleMode.Height) this.Append('left ');
        pLeftBrace?.Accept(this);
        this.Separate();
        pBody?.Accept(this);
        this.Separate();
        if (pNode.GetScaleMode() === SmScaleMode.Height) this.Append('right ');
        pRightBrace?.Accept(this);
        break;
      }
      case SmNodeType.Attribute:
        this.Append(pNode.GetToken().aText);
        this.LineToText(pNode.GetSubNode(1));
        break;
      case SmNodeType.Font:
        this.VisitFont(pNode);
        break;
      case SmNodeType.BinVer: {
        const pNum = pNode.GetSubNode(0), pDenom = pNode.GetSubNode(2);
        if (pNode.GetToken().eType === 'TOVER') {
          this.Append('{ ');
          this.LineToText(pNum);
          this.Append('over');
          this.LineToText(pDenom);
          this.Append('} ');
        } else {
          this.Append('{ frac {');
          this.LineToText(pNum);
          this.Append('} {');
          this.LineToText(pDenom);
          this.Append('} }');
        }
        break;
      }
      case SmNodeType.SubSup: {
        this.LineToText(pNode.GetBody());
        let pChild = pNode.GetSubSup(LSUP);
        if (pChild) {
          this.Separate();
          this.Append('lsup ');
          this.LineToText(pChild);
        }
        pChild = pNode.GetSubSup(LSUB);
        if (pChild) {
          this.Separate();
          this.Append('lsub ');
          this.LineToText(pChild);
        }
        pChild = pNode.GetSubSup(RSUP);
        if (pChild) {
          this.Separate();
          this.Append('^ ');
          this.LineToText(pChild);
        }
        pChild = pNode.GetSubSup(RSUB);
        if (pChild) {
          this.Separate();
          this.Append('_ ');
          this.LineToText(pChild);
        }
        pChild = pNode.GetSubSup(CSUP);
        if (pChild) {
          this.Separate();
          if (pNode.IsUseLimits()) this.Append('to ');
          else this.Append('csup ');
          this.LineToText(pChild);
        }
        pChild = pNode.GetSubSup(CSUB);
        if (pChild) {
          this.Separate();
          if (pNode.IsUseLimits()) this.Append('from ');
          else this.Append('csub ');
          this.LineToText(pChild);
        }
        break;
      }
      case SmNodeType.Matrix: {
        this.Append('matrix{');
        for (let i = 0; i < pNode.GetNumRows(); ++i) {
          for (let j = 0; j < pNode.GetNumCols(); ++j) {
            const pSubNode = pNode.GetSubNode(i * pNode.GetNumCols() + j);
            this.Separate();
            if (pSubNode) pSubNode.Accept(this);
            this.Separate();
            if (j !== pNode.GetNumCols() - 1) this.Append('#');
          }
          this.Separate();
          if (i !== pNode.GetNumRows() - 1) this.Append('##');
        }
        this.Append('} ');
        break;
      }
      case SmNodeType.Text:
        switch (pNode.GetToken().eType) {
          case 'TTEXT':
            this.Append('"');
            this.Append(pNode.GetToken().aText);
            this.Append('"');
            break;
          case 'TNUMBER':
          case 'TIDENT':
            this.Append(pNode.GetToken().aText);
            break;
          case 'TFUNC':
            this.Append('func ');
            this.Append(pNode.GetToken().aText);
            break;
          case 'THEX':
            this.Append('hex ');
            this.Append(pNode.GetToken().aText);
            break;
          default:
            this.Append(pNode.GetToken().aText);
        }
        this.Separate();
        break;
      case SmNodeType.GlyphSpecial:
        if (pNode.GetToken().eType === 'TBOPER') this.Append('boper ');
        else this.Append('uoper ');
        this.Append(pNode.GetToken().aText);
        break;
      case SmNodeType.Math:
        this.VisitMathSymbol(pNode);
        break;
      case SmNodeType.Blank: {
        const nNum = pNode.GetBlankNum();
        if (nNum <= 0) return;
        const nWide = Math.trunc(nNum / 4);
        const nNarrow = nNum % 4;
        for (let i = 0; i < nWide; i++) this.Append('~');
        for (let i = 0; i < nNarrow; i++) this.Append('`');
        this.Append(' ');
        break;
      }
      case SmNodeType.Line:
        for (const pChild of pNode.maSubNodes) {
          if (!pChild) continue;
          this.Separate();
          pChild.Accept(this);
        }
        break;
      case SmNodeType.Expression: {
        let bracketsNeeded = pNode.GetNumSubNodes() !== 1;
        if (!bracketsNeeded) {
          const pParent = pNode.GetParent();
          // nested subsups
          bracketsNeeded = !!pParent && pParent.GetType() === SmNodeType.SubSup &&
            pNode.GetNumSubNodes() === 1 && pNode.GetSubNode(0)?.GetType() === SmNodeType.SubSup;
        }
        if (bracketsNeeded) this.Append('{ ');
        for (const pChild of pNode.maSubNodes) {
          if (!pChild) continue;
          pChild.Accept(this);
          this.Separate();
        }
        if (bracketsNeeded) this.Append('} ');
        break;
      }
      case SmNodeType.Root: {
        const pExtra = pNode.GetSubNode(0), pBody = pNode.GetSubNode(2);
        if (pExtra) {
          this.Append('nroot');
          this.LineToText(pExtra);
        } else this.Append('sqrt');
        this.LineToText(pBody);
        break;
      }
      case SmNodeType.RootSymbol:
      case SmNodeType.Rectangle:
        break;
    }
  }

  private VisitFont(pNode: SmNode): void {
    let nc: number;
    switch (pNode.GetToken().eType) {
      case 'TBOLD': this.Append('bold '); break;
      case 'TNBOLD': this.Append('nbold '); break;
      case 'TITALIC': this.Append('italic '); break;
      case 'TNITALIC': this.Append('nitalic '); break;
      case 'TPHANTOM': this.Append('phantom '); break;
      case 'TSIZE': {
        this.Append('size ');
        switch (pNode.GetSizeType()) {
          case FontSizeType.PLUS: this.Append('+'); break;
          case FontSizeType.MINUS: this.Append('-'); break;
          case FontSizeType.MULTIPLY: this.Append('*'); break;
          case FontSizeType.DIVIDE: this.Append('/'); break;
          default: break;
        }
        this.Append(String(pNode.GetSizeParameter()));
        this.Separate();
        break;
      }
      case 'TDVIPSNAMESCOL':
        this.Append('color dvip ');
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        this.Append(starmathdatabase.Identify_Color_Parser(nc).aIdent);
        break;
      case 'THTMLCOL':
      case 'TMATHMLCOL':
      case 'TICONICCOL':
        this.Append('color ');
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        this.Append(starmathdatabase.Identify_Color_Parser(nc).aIdent);
        break;
      case 'TRGB':
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        this.Append('color rgb ');
        this.Append(String((nc >>> 16) & 0xFF));
        this.Separate();
        this.Append(String((nc >>> 8) & 0xFF));
        this.Separate();
        this.Append(String(nc & 0xFF));
        this.Separate();
        break;
      case 'TRGBA':
        this.Append('color rgba ');
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        this.Append(String((nc >>> 16) & 0xFF));
        this.Separate();
        this.Append(String((nc >>> 8) & 0xFF));
        this.Separate();
        this.Append(String(nc & 0xFF));
        this.Separate();
        this.Append(String((nc >>> 24) & 0xFF));
        this.Separate();
        break;
      case 'THEX':
        this.Append('color hex ');
        nc = parseInt(pNode.GetToken().cMathChar, 16) >>> 0;
        this.Append(nc.toString(16));
        this.Separate();
        break;
      case 'TSANS': this.Append('font sans '); break;
      case 'TSERIF': this.Append('font serif '); break;
      case 'TFIXED': this.Append('font fixed '); break;
      default: break;
    }
    this.LineToText(pNode.GetSubNode(1));
  }

  //TODO to improve this it is required to improve mathmlimport.
  private VisitMathSymbol(pNode: SmNode): void {
    const nGroup = pNode.GetToken().nGroup;
    if ((nGroup & TG.LBrace) || (nGroup & TG.RBrace) || (nGroup & TG.Sum) || (nGroup & TG.Product) ||
      (nGroup & TG.Relation) || (nGroup & TG.UnOper) || (nGroup & TG.Oper)) {
      this.Append(pNode.GetToken().aText);
      return;
    }
    const cChar = char0(pNode.GetToken().cMathChar);
    this.Separate();
    switch (cChar) {
      case MS_RIGHTARROW:
        if (pNode.GetToken().eType === 'TTOWARD') this.Append('toward');
        else this.Append('rightarrow');
        break;
      case 0xeb01: //no space
      case 0xeb08: //normal space
        break;
      default:
        // Upstream appends the first UTF-16 unit, a lone surrogate for a character outside the
        // BMP (LibreOffice then fails to save the formula); take the whole character instead.
        this.Append(aMathSymbolNames.get(cChar) ?? String.fromCodePoint(pNode.GetToken().cMathChar.codePointAt(0) ?? 0));
        break;
    }
  }

  /** Extract text from a pNode that constitutes a line. */
  private LineToText(pNode: SmNode | null): void {
    this.Separate();
    if (pNode) pNode.Accept(this);
    this.Separate();
  }

  /** Appends rText to maCmdText. */
  private Append(rText: string): void {
    this.maCmdText += rText;
  }

  /** Append a blank for separation, if needed. It is needed if last char is not ' '. */
  private Separate(): void {
    if (this.maCmdText && !this.maCmdText.endsWith(' ')) this.maCmdText += ' ';
  }
}

// The cases of SmNodeToTextVisitor::Visit(SmMathSymbolNode*) that write a name.
const aMathSymbolNames = new Map<number, string>([
  [MS_NONE, 'none'], [0x7B, '{'], [0x7D, '}'], [MS_VERTLINE, 'mline'], [MS_TILDE, '"~"'],
  [MS_LEFTARROW, 'leftarrow'], [MS_UPARROW, 'uparrow'], [MS_DOWNARROW, 'downarrow'],
  [MS_LAMBDABAR, 'lambdabar'], [MS_DOTSLOW, 'dotslow'], [MS_SETC, 'setC'], [MS_HBAR, 'hbar'], [MS_IM, 'Im'],
  [MS_SETN, 'setN'], [MS_WP, 'wp'], [MS_LAPLACE, 'laplace'], [MS_SETQ, 'setQ'], [MS_RE, 'Re'], [MS_SETR, 'setR'],
  [MS_SETZ, 'setZ'], [MS_ALEPH, 'aleph'], [MS_DLARROW, 'dlarrow'], [MS_DRARROW, 'drarrow'],
  [MS_DLRARROW, 'dlrarrow'], [MS_FORALL, 'forall'], [MS_PARTIAL, 'partial'], [MS_EXISTS, 'exists'],
  [MS_NOTEXISTS, 'notexists'], [MS_EMPTYSET, 'emptyset'], [MS_NABLA, 'nabla'], [MS_BACKEPSILON, 'backepsilon'],
  [MS_CIRC, 'circ'], [MS_INFINITY, 'infinity'], [MS_ORTHO, 'ortho'], [MS_DOTSVERT, 'dotsvert'],
  [MS_DOTSAXIS, 'dotsaxis'], [MS_DOTSUP, 'dotsup'], [MS_DOTSDOWN, 'dotsdown'], [0x5E, '^'],
  [0xe091, 'widehat'], [0xe096, 'widetilde'], [0x0362, 'widevec'], [0xe098, 'widevec'],
  [0xef04, '`'], [0xef05, '`'], [0xeb02, '`'], [0xeb04, '`'], [0xeb05, '~'], [0x3a9, '%OMEGA'],
]);

// starmath/source/mathml/mathmlimport.cxx

/** The attributes of an element: `sName` is the unprefixed name (null for a prefixed one, which
 *  the fast parser's token switch would not match), `sLocal` the name without any prefix. */
interface Attr { sName: string | null; sLocal: string; sValue: string }

class SmXMLImport {
  /** SmNodeStack: front is the end of the array. */
  aNodeStack: SmNode[] = [];
  aText = '';
  /** The XML measure unit of the MM100 unit converter, as SmXMLContext_Helper sets it. */
  bMeasureUnitPercent = false;

  GetNodeStack(): SmNode[] { return this.aNodeStack; }
  GetText(): string { return this.aText; }
  SetText(r: string): void { this.aText = r; }

  endDocument(): string {
    //Set the resulted tree into the SmDocShell where it belongs
    const pTree = popOrZero(this.aNodeStack);
    if (pTree && pTree.GetType() === SmNodeType.Table) {
      if (!this.aText) //If we picked up no annotation text
      {
        // Get text from imported formula
        this.aText = new SmNodeToTextVisitor(pTree).GetText();
      }
    }
    return this.aText;
  }
}

function popOrZero(rStack: SmNode[]): SmNode | null {
  return rStack.pop() ?? null;
}

/** o3tl::trim */
const isWhitespace = (c: number): boolean => (c <= 32 && c !== 0) || (c >= 0x2000 && c <= 0x200B) || c === 0x2028 || c === 0x2029;
function trim(s: string): string {
  let a = 0, b = s.length;
  while (a < b && isWhitespace(s.charCodeAt(a))) a++;
  while (b > a && isWhitespace(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

class SmXMLImportContext {
  rImport: SmXMLImport;
  constructor(rImport: SmXMLImport) { this.rImport = rImport; }
  GetSmImport(): SmXMLImport { return this.rImport; }

  TCharacters(_rChars: string): void {}
  characters(rChars: string): void {
    /*
    Whitespace occurring within the content of token elements is "trimmed"
    from the ends (i.e. all whitespace at the beginning and end of the
    content is removed), and "collapsed" internally (i.e. each sequence of
    1 or more whitespace characters is replaced with one blank character).
    */
    //collapsing not done yet!
    const aChars2 = trim(rChars);
    if (aChars2) this.TCharacters(aChars2 /*.collapse()*/);
  }
  startFastElement(_rAttrs: Attr[]): void {}
  createFastChildContext(_nElement: string): SmXMLImportContext | null { return null; }
  endFastElement(): void {}
}

class SmXMLContext_Helper {
  nIsBold = -1;
  nIsItalic = -1;
  nFontSize = 0.0;
  sFontFamily = '';
  sColor = '';
  rContext: SmXMLImportContext;

  constructor(rImport: SmXMLImportContext) { this.rContext = rImport; }

  IsFontNodeNeeded(): boolean {
    return this.nIsBold !== -1 || this.nIsItalic !== -1 || this.nFontSize !== 0.0 || this.sFontFamily !== '' || this.sColor !== '';
  }

  RetrieveAttrs(xAttrList: Attr[]): void {
    let bMvFound = false;
    for (const aIter of xAttrList) {
      // sometimes they have namespace, sometimes not?
      switch (aIter.sLocal) {
        case 'fontweight':
          this.nIsBold = aIter.sValue === 'bold' ? 1 : 0;
          break;
        case 'fontstyle':
          this.nIsItalic = aIter.sValue === 'italic' ? 1 : 0;
          break;
        case 'fontsize':
        case 'mathsize': {
          const sValue = aIter.sValue;
          this.nFontSize = convertDouble(sValue);
          this.rContext.GetSmImport().bMeasureUnitPercent = false;
          if (!sValue.includes('pt')) {
            if (!sValue.includes('%')) this.nFontSize = 0.0;
            else this.rContext.GetSmImport().bMeasureUnitPercent = true;
          }
          break;
        }
        case 'fontfamily':
          this.sFontFamily = aIter.sValue;
          break;
        case 'color':
        case 'mathcolor':
          this.sColor = aIter.sValue;
          break;
        case 'mathvariant':
          bMvFound = true;
          break;
        default:
          break;
      }
    }

    if (bMvFound) {
      // Ignore deprecated attributes fontfamily, fontweight, and fontstyle
      // in favor of mathvariant, as specified in
      // <https://www.w3.org/TR/MathML3/chapter3.html#presm.deprecatt>.
      this.sFontFamily = '';
      this.nIsBold = -1;
      this.nIsItalic = -1;
    }
  }

  ApplyAttrs(): void {
    const rNodeStack = this.rContext.GetSmImport().GetNodeStack();

    if (!this.IsFontNodeNeeded()) return;

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.nLevel = 5;

    if (this.nIsBold !== -1) {
      if (this.nIsBold) aToken.eType = 'TBOLD';
      else aToken.eType = 'TNBOLD';
      const pFontNode = new SmNode(SmNodeType.Font, aToken);
      pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
      rNodeStack.push(pFontNode);
    }
    if (this.nIsItalic !== -1) {
      if (this.nIsItalic) aToken.eType = 'TITALIC';
      else aToken.eType = 'TNITALIC';
      const pFontNode = new SmNode(SmNodeType.Font, aToken);
      pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
      rNodeStack.push(pFontNode);
    }
    if (this.nFontSize !== 0.0) {
      aToken.eType = 'TSIZE';
      const pFontNode = new SmNode(SmNodeType.Font, aToken);

      if (this.rContext.GetSmImport().bMeasureUnitPercent) {
        if (this.nFontSize < 100.00) pFontNode.SetSizeParameter(100.00 / this.nFontSize, FontSizeType.DIVIDE);
        else pFontNode.SetSizeParameter(this.nFontSize / 100.00, FontSizeType.MULTIPLY);
      } else pFontNode.SetSizeParameter(this.nFontSize, FontSizeType.ABSOLUT);

      pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
      rNodeStack.push(pFontNode);
    }
    if (this.sColor) {
      let aSmColorTokenTableEntry = starmathdatabase.Identify_ColorName_HTML(this.sColor);
      if (aSmColorTokenTableEntry.eType === 'TRGB')
        aSmColorTokenTableEntry = starmathdatabase.Identify_Color_Parser(aSmColorTokenTableEntry.cColor);
      if (aSmColorTokenTableEntry.eType !== 'TERROR') {
        aToken.assignColor(aSmColorTokenTableEntry);
        const pFontNode = new SmNode(SmNodeType.Font, aToken);
        pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
        rNodeStack.push(pFontNode);
      }
      // If not known, not implemented yet. Giving up.
    }
    if (!this.sFontFamily) return;

    const sFamily = this.sFontFamily.toLowerCase();
    if (sFamily === 'fixed') aToken.eType = 'TFIXED';
    else if (sFamily === 'sans') aToken.eType = 'TSANS';
    else if (sFamily === 'serif') aToken.eType = 'TSERIF';
    else //Just give up, we need to extend our font mechanism to be
      //more general
      return;

    aToken.aText = this.sFontFamily;
    const pFontNode = new SmNode(SmNodeType.Font, aToken);
    pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
    rNodeStack.push(pFontNode);
  }
}

/** sax::Converter::convertDouble: the leading number of the value. */
function convertDouble(s: string): number {
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : 0;
}

class SmXMLTokenAttrHelper {
  mrContext: SmXMLImportContext;
  meMv: MathMLMathvariantValue = MathMLMathvariantValue.Normal;
  mbMvFound = false;

  constructor(rContext: SmXMLImportContext) { this.mrContext = rContext; }

  RetrieveAttrs(xAttrList: Attr[]): void {
    for (const aIter of xAttrList) {
      switch (aIter.sName) {
        case 'mathvariant':
          if (aMathvariantValues.has(aIter.sValue)) this.meMv = aIter.sValue as MathMLMathvariantValue;
          this.mbMvFound = true;
          break;
        default:
          break;
      }
    }
  }

  ApplyAttrs(eDefaultMv: MathMLMathvariantValue): void {
    const vVariant: SmTokenType[] = [];
    const eMv = this.mbMvFound ? this.meMv : eDefaultMv;
    switch (eMv) {
      case MathMLMathvariantValue.Normal:
        vVariant.push('TNITALIC');
        break;
      case MathMLMathvariantValue.Bold:
      case MathMLMathvariantValue.BoldFraktur:
      // TODO: Fraktur
      case MathMLMathvariantValue.BoldScript:
        // TODO: Script
        vVariant.push('TBOLD');
        break;
      case MathMLMathvariantValue.Italic:
        // nothing to do
        break;
      case MathMLMathvariantValue.BoldItalic:
        vVariant.push('TITALIC');
        vVariant.push('TBOLD');
        break;
      case MathMLMathvariantValue.DoubleStruck:
      case MathMLMathvariantValue.Script:
      case MathMLMathvariantValue.Fraktur:
        // TODO
        break;
      case MathMLMathvariantValue.SansSerif:
        vVariant.push('TSANS');
        break;
      case MathMLMathvariantValue.BoldSansSerif:
        vVariant.push('TSANS');
        vVariant.push('TBOLD');
        break;
      case MathMLMathvariantValue.SansSerifItalic:
        vVariant.push('TITALIC');
        vVariant.push('TSANS');
        break;
      case MathMLMathvariantValue.SansSerifBoldItalic:
        vVariant.push('TITALIC');
        vVariant.push('TBOLD');
        vVariant.push('TSANS');
        break;
      case MathMLMathvariantValue.Monospace:
        vVariant.push('TFIXED');
        break;
      default:
        // TODO
        break;
    }
    if (!vVariant.length) return;
    const rNodeStack = this.mrContext.GetSmImport().GetNodeStack();
    for (const eType of vVariant) {
      const aToken = new SmToken();
      aToken.eType = eType;
      aToken.cMathChar = '';
      aToken.nLevel = 5;
      const pFontNode = new SmNode(SmNodeType.Font, aToken);
      pFontNode.SetSubNodes(null, popOrZero(rNodeStack));
      rNodeStack.push(pFontNode);
    }
  }
}

class SmXMLDocContext_Impl extends SmXMLImportContext {
  override createFastChildContext(nElement: string): SmXMLImportContext | null {
    let xContext: SmXMLImportContext | null;
    const rImport = this.GetSmImport();

    switch (nElement) {
      //Consider semantics a dummy except for any starmath annotations
      case 'semantics':
      /*General Layout Schemata*/
      case 'mrow':
        xContext = new SmXMLRowContext_Impl(rImport);
        break;
      case 'menclose':
        xContext = new SmXMLEncloseContext_Impl(rImport);
        break;
      case 'mfrac':
        xContext = new SmXMLFracContext_Impl(rImport);
        break;
      case 'msqrt':
        xContext = new SmXMLSqrtContext_Impl(rImport);
        break;
      case 'mroot':
        xContext = new SmXMLRootContext_Impl(rImport);
        break;
      case 'mstyle':
        xContext = new SmXMLStyleContext_Impl(rImport);
        break;
      case 'merror':
        xContext = new SmXMLErrorContext_Impl(rImport);
        break;
      case 'mpadded':
        xContext = new SmXMLPaddedContext_Impl(rImport);
        break;
      case 'mphantom':
        xContext = new SmXMLPhantomContext_Impl(rImport);
        break;
      case 'mfenced':
        xContext = new SmXMLFencedContext_Impl(rImport);
        break;
      /*Script and Limit Schemata*/
      case 'msub':
        xContext = new SmXMLSubContext_Impl(rImport);
        break;
      case 'msup':
        xContext = new SmXMLSupContext_Impl(rImport);
        break;
      case 'msubsup':
        xContext = new SmXMLSubSupContext_Impl(rImport);
        break;
      case 'munder':
        xContext = new SmXMLUnderContext_Impl(rImport);
        break;
      case 'mover':
        xContext = new SmXMLOverContext_Impl(rImport);
        break;
      case 'munderover':
        xContext = new SmXMLUnderOverContext_Impl(rImport);
        break;
      case 'mmultiscripts':
        xContext = new SmXMLMultiScriptsContext_Impl(rImport);
        break;
      case 'mtable':
        xContext = new SmXMLTableContext_Impl(rImport);
        break;
      case 'maction':
        xContext = new SmXMLActionContext_Impl(rImport);
        break;
      default: {
        /*Basically there's an implicit mrow around certain bare
         *elements, use a RowContext to see if this is one of
         *those ones*/
        const aTempContext = new SmXMLRowContext_Impl(rImport);
        xContext = aTempContext.StrictCreateChildContext(nElement);
        break;
      }
    }
    return xContext;
  }

  override endFastElement(): void {
    const rNodeStack = this.GetSmImport().GetNodeStack();

    const pContextNode = popOrZero(rNodeStack);

    const aDummy = new SmToken();
    const pSNode = new SmNode(SmNodeType.Line, aDummy);
    pSNode.SetSubNodes(pContextNode, null);
    rNodeStack.push(pSNode);

    const n = rNodeStack.length;
    const LineArray = new Array<SmNode | null>(n);
    for (let j = 0; j < n; j++) {
      const pNode = rNodeStack.pop()!;
      LineArray[n - (j + 1)] = pNode;
    }
    const pSNode2 = new SmNode(SmNodeType.Table, aDummy);
    pSNode2.SetSubNodes(LineArray);
    rNodeStack.push(pSNode2);
  }
}

/*avert the gaze from the originator*/
class SmXMLRowContext_Impl extends SmXMLDocContext_Impl {
  protected nElementCount: number;

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.nElementCount = rImport.GetNodeStack().length;
  }

  override endFastElement(): void {
    let aRelationArray: (SmNode | null)[] = [];
    const rNodeStack = this.GetSmImport().GetNodeStack();

    if (rNodeStack.length > this.nElementCount) {
      const nSize = rNodeStack.length - this.nElementCount;

      aRelationArray = new Array<SmNode | null>(nSize);
      for (let j = nSize; j > 0; j--) {
        const pNode = rNodeStack.pop()!;
        aRelationArray[j - 1] = pNode;
      }

      //If the first or last element is an operator with stretchyness
      //set then we must create a brace node here from those elements,
      //removing the stretchness from the operators and applying it to
      //ourselves, and creating the appropriate dummy StarMath none bracket
      //to balance the arrangement
      const first = aRelationArray[0]!, last = aRelationArray[nSize - 1]!;
      if ((first.GetScaleMode() === SmScaleMode.Height && first.GetType() === SmNodeType.Math) ||
        (last.GetScaleMode() === SmScaleMode.Height && last.GetType() === SmNodeType.Math)) {
        let aToken = new SmToken();
        aToken.cMathChar = '';
        aToken.nLevel = 5;

        let nLeft = 0, nRight = 0;
        if (first.GetScaleMode() === SmScaleMode.Height && first.GetType() === SmNodeType.Math) {
          aToken = first.GetToken().clone();
          nLeft = 1;
        } else aToken.cMathChar = '';

        aToken.eType = 'TLPARENT';
        const pLeft = new SmNode(SmNodeType.Math, aToken);

        if (last.GetScaleMode() === SmScaleMode.Height && last.GetType() === SmNodeType.Math) {
          aToken = last.GetToken().clone();
          nRight = 1;
        } else aToken.cMathChar = '';

        aToken.eType = 'TRPARENT';
        const pRight = new SmNode(SmNodeType.Math, aToken);

        const aRelationArray2: (SmNode | null)[] = [];

        //!! nSize-nLeft-nRight may be < 0 !!
        const nRelArrSize = nSize - nLeft - nRight;
        for (let i = 0; i < nRelArrSize; i++) aRelationArray2.push(aRelationArray[i + nLeft]!);

        const aDummy = new SmToken();
        const pSNode = new SmNode(SmNodeType.Brace, aToken);
        const pBody = new SmNode(SmNodeType.Expression, aDummy);
        pBody.SetSubNodes(aRelationArray2);

        pSNode.SetSubNodes(pLeft, pBody, pRight);
        pSNode.SetScaleMode(SmScaleMode.Height);
        rNodeStack.push(pSNode);
        return;
      }
    } else {
      // The elements msqrt, mstyle, merror, menclose, mpadded, mphantom, mtd, and math
      // treat their content as a single inferred mrow in case their content is empty.
      // Here an empty group {} is used to catch those cases and transform them without error
      // to StarMath.
      const aToken = new SmToken();
      aToken.setChar(MS_LBRACE);
      aToken.nLevel = 5;
      aToken.eType = 'TLGROUP';
      aToken.nGroup = TG.NONE;
      aToken.aText = '{';
      aRelationArray[0] = new SmNode(SmNodeType.Line, aToken);

      aToken.setChar(MS_RBRACE);
      aToken.nLevel = 0;
      aToken.eType = 'TRGROUP';
      aToken.nGroup = TG.NONE;
      aToken.aText = '}';
      aRelationArray[1] = new SmNode(SmNodeType.Line, aToken);
    }

    const aDummy = new SmToken();
    const pSNode = new SmNode(SmNodeType.Expression, aDummy);
    pSNode.SetSubNodes(aRelationArray);
    rNodeStack.push(pSNode);
  }

  StrictCreateChildContext(nElement: string): SmXMLImportContext | null {
    let pContext: SmXMLImportContext | null = null;
    const rImport = this.GetSmImport();

    switch (nElement) {
      /*Note that these should accept malignmark subelements, but do not*/
      case 'mn':
        pContext = new SmXMLNumberContext_Impl(rImport);
        break;
      case 'mi':
        pContext = new SmXMLIdentifierContext_Impl(rImport);
        break;
      case 'mo':
        pContext = new SmXMLOperatorContext_Impl(rImport);
        break;
      case 'mtext':
        pContext = new SmXMLTextContext_Impl(rImport);
        break;
      case 'mspace':
        pContext = new SmXMLSpaceContext_Impl(rImport);
        break;
      case 'ms':
        pContext = new SmXMLStringContext_Impl(rImport);
        break;

      /*Note: The maligngroup should only be seen when the row
       * (or descendants) are in a table*/
      case 'maligngroup':
        pContext = new SmXMLAlignGroupContext_Impl(rImport);
        break;

      case 'annotation':
        pContext = new SmXMLAnnotationContext_Impl(rImport);
        break;

      default:
        break;
    }
    return pContext;
  }

  override createFastChildContext(nElement: string): SmXMLImportContext | null {
    let xContext = this.StrictCreateChildContext(nElement);

    if (!xContext) {
      //Hmm, unrecognized for this level, check to see if it's
      //an element that can have an implicit schema around it
      xContext = super.createFastChildContext(nElement);
    }
    return xContext;
  }
}

class SmXMLEncloseContext_Impl extends SmXMLRowContext_Impl {
  // TODO/LATER: convert <menclose notation="horizontalstrike"> into
  // "overstrike{}" and extend the Math syntax to support more notations
  override endFastElement(): void {
    /*
    <menclose> accepts any number of arguments; if this number is not 1, its
    contents are treated as a single "inferred <mrow>" containing its
    arguments
    */
    if (this.GetSmImport().GetNodeStack().length - this.nElementCount !== 1) super.endFastElement();
  }
}

class SmXMLFracContext_Impl extends SmXMLRowContext_Impl {
  // TODO/LATER: convert <mfrac bevelled="true"> into "wideslash{}{}"
  override endFastElement(): void {
    const rNodeStack = this.GetSmImport().GetNodeStack();
    const bNodeCheck = rNodeStack.length - this.nElementCount === 2;
    if (!bNodeCheck) return;

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = 'TFRAC';
    const pSNode = new SmNode(SmNodeType.BinVer, aToken);
    const pOper = new SmNode(SmNodeType.Rectangle, aToken);
    const pSecond = popOrZero(rNodeStack);
    const pFirst = popOrZero(rNodeStack);
    pSNode.SetSubNodes(pFirst, pOper, pSecond);
    rNodeStack.push(pSNode);
  }
}

class SmXMLRootContext_Impl extends SmXMLRowContext_Impl {
  override endFastElement(): void {
    /*The <mroot> element requires exactly 2 arguments.*/
    const bNodeCheck = this.GetSmImport().GetNodeStack().length - this.nElementCount === 2;
    if (!bNodeCheck) return;

    const aToken = new SmToken();
    aToken.setChar(MS_SQRT); //Temporary: alert, based on StarSymbol font
    aToken.eType = 'TNROOT';
    const pSNode = new SmNode(SmNodeType.Root, aToken);
    const pOper = new SmNode(SmNodeType.RootSymbol, aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();
    const pIndex = popOrZero(rNodeStack);
    const pBase = popOrZero(rNodeStack);
    pSNode.SetSubNodes(pIndex, pOper, pBase);
    rNodeStack.push(pSNode);
  }
}

class SmXMLSqrtContext_Impl extends SmXMLRowContext_Impl {
  override endFastElement(): void {
    /*
    <msqrt> accepts any number of arguments; if this number is not 1, its
    contents are treated as a single "inferred <mrow>" containing its
    arguments
    */
    if (this.GetSmImport().GetNodeStack().length - this.nElementCount !== 1) super.endFastElement();

    const aToken = new SmToken();
    aToken.setChar(MS_SQRT); //Temporary: alert, based on StarSymbol font
    aToken.eType = 'TSQRT';
    const pSNode = new SmNode(SmNodeType.Root, aToken);
    const pOper = new SmNode(SmNodeType.RootSymbol, aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();
    pSNode.SetSubNodes(null, pOper, popOrZero(rNodeStack));
    rNodeStack.push(pSNode);
  }
}

class SmXMLStyleContext_Impl extends SmXMLRowContext_Impl {
  protected aStyleHelper = new SmXMLContext_Helper(this);

  override startFastElement(xAttrList: Attr[]): void {
    this.aStyleHelper.RetrieveAttrs(xAttrList);
  }

  override endFastElement(): void {
    /*
    <mstyle> accepts any number of arguments; if this number is not 1, its
    contents are treated as a single "inferred <mrow>" containing its
    arguments
    */
    const rNodeStack = this.GetSmImport().GetNodeStack();
    if (rNodeStack.length - this.nElementCount !== 1) super.endFastElement();
    this.aStyleHelper.ApplyAttrs();
  }
}

class SmXMLPaddedContext_Impl extends SmXMLRowContext_Impl {
  override endFastElement(): void {
    /*
    <mpadded> accepts any number of arguments; if this number is not 1, its
    contents are treated as a single "inferred <mrow>" containing its
    arguments
    */
    if (this.GetSmImport().GetNodeStack().length - this.nElementCount !== 1) super.endFastElement();
  }
}

class SmXMLPhantomContext_Impl extends SmXMLRowContext_Impl {
  override endFastElement(): void {
    /*
    <mphantom> accepts any number of arguments; if this number is not 1, its
    contents are treated as a single "inferred <mrow>" containing its
    arguments
    */
    if (this.GetSmImport().GetNodeStack().length - this.nElementCount !== 1) super.endFastElement();

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.nLevel = 5;
    aToken.eType = 'TPHANTOM';

    const pPhantom = new SmNode(SmNodeType.Font, aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();
    pPhantom.SetSubNodes(null, popOrZero(rNodeStack));
    rNodeStack.push(pPhantom);
  }
}

class SmXMLFencedContext_Impl extends SmXMLRowContext_Impl {
  protected cBegin = '(';
  protected cEnd = ')';
  protected bIsStretchy = false;

  override startFastElement(xAttrList: Attr[]): void {
    for (const aIter of xAttrList) {
      switch (aIter.sName) {
        //temp, starmath cannot handle multichar brackets (I think)
        case 'open':
          this.cBegin = aIter.sValue;
          break;
        case 'close':
          this.cEnd = aIter.sValue;
          break;
        case 'stretchy':
          this.bIsStretchy = aIter.sValue === 'true';
          break;
        default:
          /*Go to superclass*/
          break;
      }
    }
  }

  override endFastElement(): void {
    let aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.aText = ',';
    aToken.nLevel = 5;

    const pSNode = new SmNode(SmNodeType.Brace, aToken);
    if (this.bIsStretchy) aToken = starmathdatabase.Identify_PrefixPostfix_SmXMLOperatorContext_Impl(this.cBegin);
    else aToken = starmathdatabase.Identify_Prefix_SmXMLOperatorContext_Impl(this.cBegin);
    if (aToken.eType === 'TERROR') aToken = new SmToken('TLPARENT', MS_LPARENT, '(', TG.LBrace, 5);
    const pLeft = new SmNode(SmNodeType.Math, aToken);
    if (this.bIsStretchy) aToken = starmathdatabase.Identify_PrefixPostfix_SmXMLOperatorContext_Impl(this.cEnd);
    else aToken = starmathdatabase.Identify_Postfix_SmXMLOperatorContext_Impl(this.cEnd);
    if (aToken.eType === 'TERROR') aToken = new SmToken('TRPARENT', MS_RPARENT, ')', TG.LBrace, 5);
    const pRight = new SmNode(SmNodeType.Math, aToken);

    const rNodeStack = this.GetSmImport().GetNodeStack();
    aToken.cMathChar = '';
    aToken.eType = 'TIDENT';

    let i = rNodeStack.length - this.nElementCount;
    if (rNodeStack.length - this.nElementCount > 1) i += rNodeStack.length - 1 - this.nElementCount;
    const aRelationArray = new Array<SmNode | null>(i).fill(null);
    while (rNodeStack.length > this.nElementCount) {
      const pNode = rNodeStack.pop()!;
      aRelationArray[--i] = pNode;
      if (i > 1 && rNodeStack.length > 1) aRelationArray[--i] = new SmNode(SmNodeType.GlyphSpecial, aToken);
    }

    const aDummy = new SmToken();
    const pBody = new SmNode(SmNodeType.Expression, aDummy);
    pBody.SetSubNodes(aRelationArray);

    pSNode.SetSubNodes(pLeft, pBody, pRight);
    // mfenced is always scalable. Stretchy keyword is not official, but in case of been in there
    // can be used as a hint.
    pSNode.SetScaleMode(SmScaleMode.Height);
    this.GetSmImport().GetNodeStack().push(pSNode);
  }
}

class SmXMLErrorContext_Impl extends SmXMLRowContext_Impl {
  override endFastElement(): void {
    /*Right now the error tag is completely ignored, what
     can I do with it in starmath, ?, maybe we need a
     report window ourselves, do a test for validity of
     the xml input, use mirrors, and then generate
     the markup inside the merror with a big red colour
     of something. For now just throw them all away.
     */
    const rNodeStack = this.GetSmImport().GetNodeStack();
    while (rNodeStack.length > this.nElementCount) rNodeStack.pop();
  }
}

class SmXMLNumberContext_Impl extends SmXMLImportContext {
  protected aToken = new SmToken();

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.aToken.cMathChar = '';
    this.aToken.nLevel = 5;
    this.aToken.eType = 'TNUMBER';
  }

  override TCharacters(rChars: string): void { this.aToken.aText = rChars; }

  override endFastElement(): void {
    this.GetSmImport().GetNodeStack().push(new SmNode(SmNodeType.Text, this.aToken));
  }
}

class SmXMLAnnotationContext_Impl extends SmXMLImportContext {
  private mnStarMathVersion = 0;

  override characters(rChars: string): void {
    if (this.mnStarMathVersion) this.GetSmImport().SetText(this.GetSmImport().GetText() + rChars);
  }

  override startFastElement(xAttrList: Attr[]): void {
    for (const aIter of xAttrList) {
      // sometimes they have namespace, sometimes not?
      switch (aIter.sLocal) {
        case 'encoding':
          this.mnStarMathVersion = aIter.sValue === 'StarMath 5.0' ? 5 : aIter.sValue === 'StarMath 6' ? 6 : 0;
          break;
        default:
          break;
      }
    }
  }
}

class SmXMLTextContext_Impl extends SmXMLImportContext {
  protected aToken = new SmToken();

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.aToken.cMathChar = '';
    this.aToken.nLevel = 5;
    this.aToken.eType = 'TTEXT';
  }

  override TCharacters(rChars: string): void { this.aToken.aText = rChars; }

  override endFastElement(): void {
    this.GetSmImport().GetNodeStack().push(new SmNode(SmNodeType.Text, this.aToken));
  }
}

class SmXMLStringContext_Impl extends SmXMLImportContext {
  protected aToken = new SmToken();

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.aToken.cMathChar = '';
    this.aToken.nLevel = 5;
    this.aToken.eType = 'TTEXT';
  }

  override TCharacters(rChars: string): void {
    /*
    The content of <ms> elements should be rendered with visible "escaping" of
    certain characters in the content, including at least "double quote"
    itself, and preferably whitespace other than individual blanks. The intent
    is for the viewer to see that the expression is a string literal, and to
    see exactly which characters form its content. For example, <ms>double
    quote is "</ms> might be rendered as "double quote is \"".

    Obviously this isn't fully done here.
    */
    this.aToken.aText = '"' + rChars + '"';
  }

  override endFastElement(): void {
    this.GetSmImport().GetNodeStack().push(new SmNode(SmNodeType.Text, this.aToken));
  }
}

class SmXMLIdentifierContext_Impl extends SmXMLImportContext {
  private maTokenAttrHelper = new SmXMLTokenAttrHelper(this);
  private aStyleHelper = new SmXMLContext_Helper(this);
  private aToken = new SmToken();

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.aToken.cMathChar = '';
    this.aToken.nLevel = 5;
    this.aToken.eType = 'TIDENT';
  }

  override startFastElement(xAttrList: Attr[]): void {
    this.maTokenAttrHelper.RetrieveAttrs(xAttrList);
    this.aStyleHelper.RetrieveAttrs(xAttrList);
  }

  override endFastElement(): void {
    //we will handle identifier italic/normal here instead of with a standalone
    //font node (the font itself does not show in the text)
    if ((this.aStyleHelper.nIsItalic === -1 && this.aToken.aText.length > 1) ||
      (this.aStyleHelper.nIsItalic === 0 && this.aToken.aText.length === 1)) {
      this.aStyleHelper.nIsItalic = -1;
    }
    const pNode = new SmNode(SmNodeType.Text, this.aToken);
    if (this.aStyleHelper.nIsItalic !== -1) this.aStyleHelper.nIsItalic = -1;
    this.GetSmImport().GetNodeStack().push(pNode);
    this.aStyleHelper.ApplyAttrs();

    this.maTokenAttrHelper.ApplyAttrs(this.aToken.aText.length === 1 ? MathMLMathvariantValue.Italic : MathMLMathvariantValue.Normal);
  }

  override TCharacters(rChars: string): void { this.aToken.aText = rChars; }
}

class SmXMLOperatorContext_Impl extends SmXMLImportContext {
  private maTokenAttrHelper = new SmXMLTokenAttrHelper(this);
  private bIsStretchy = false;
  private bIsFenced = false;
  private isPrefix = false;
  private isInfix = false;
  private isPostfix = false;
  private aToken = new SmToken();

  constructor(rImport: SmXMLImport) {
    super(rImport);
    this.aToken.eType = 'TSPECIAL';
    this.aToken.nLevel = 5;
  }

  override TCharacters(rChars: string): void {
    this.aToken.setChar(rChars);
    let bToken: SmToken;
    if (this.bIsFenced) {
      if (this.isPrefix) bToken = starmathdatabase.Identify_Prefix_SmXMLOperatorContext_Impl(this.aToken.cMathChar);
      else if (this.isInfix) bToken = new SmToken('TMLINE', MS_VERTLINE, 'mline', TG.NONE, 0);
      else if (this.isPostfix) bToken = starmathdatabase.Identify_Postfix_SmXMLOperatorContext_Impl(this.aToken.cMathChar);
      else bToken = starmathdatabase.Identify_PrefixPostfix_SmXMLOperatorContext_Impl(this.aToken.cMathChar);
    } else bToken = starmathdatabase.Identify_SmXMLOperatorContext_Impl(this.aToken.cMathChar, this.bIsStretchy);
    if (bToken.eType !== 'TERROR') this.aToken = bToken;
  }

  override endFastElement(): void {
    const pNode = new SmNode(SmNodeType.Math, this.aToken);
    //For stretchy scaling the scaling must be retrieved from this node
    //and applied to the expression itself so as to get the expression
    //to scale the operator to the height of the expression itself
    if (this.bIsStretchy) pNode.SetScaleMode(SmScaleMode.Height);
    this.GetSmImport().GetNodeStack().push(pNode);

    // TODO: apply to non-alphabetic characters too
    if (/^[A-Za-z]/.test(this.aToken.cMathChar)) this.maTokenAttrHelper.ApplyAttrs(MathMLMathvariantValue.Normal);
  }

  override startFastElement(xAttrList: Attr[]): void {
    this.maTokenAttrHelper.RetrieveAttrs(xAttrList);

    for (const aIter of xAttrList) {
      switch (aIter.sName) {
        case 'stretchy':
          this.bIsStretchy = aIter.sValue === 'true';
          break;
        case 'fence':
          this.bIsFenced = aIter.sValue === 'true';
          break;
        case 'form':
          this.isPrefix = aIter.sValue === 'prefix'; // <
          this.isInfix = aIter.sValue === 'infix'; // |
          this.isPostfix = aIter.sValue === 'postfix'; // >
          break;
        default:
          break;
      }
    }
  }
}

function lcl_CountBlanks(rLV: MathMLAttributeLengthValue): { nWide: number; nNarrow: number } | null {
  if (rLV.aNumber === 0) return { nWide: 0, nNarrow: 0 };
  // TODO: honor other units than em
  if (rLV.eUnit !== MathMLLengthUnit.Em) return null;
  if (rLV.aNumber < 0) return null;
  const nWide = Math.trunc(rLV.aNumber / 2);
  if (nWide < 0) return null;
  const nNarrow = Math.trunc((rLV.aNumber - nWide * 2) / 0.5);
  if (nNarrow < 0) return null;
  return { nWide, nNarrow };
}

class SmXMLSpaceContext_Impl extends SmXMLImportContext {
  override startFastElement(xAttrList: Attr[]): void {
    // There is no syntax in Math to specify blank nodes of arbitrary size yet.
    const aLV: MathMLAttributeLengthValue = { aNumber: 0, eUnit: MathMLLengthUnit.None };
    let nWide = 0, nNarrow = 0;

    for (const aIter of xAttrList) {
      switch (aIter.sName) {
        case 'width': {
          const r = ParseMathMLAttributeLengthValue(trim(aIter.sValue), aLV) ? lcl_CountBlanks(aLV) : null;
          if (r) ({ nWide, nNarrow } = r);
          break;
        }
        default:
          break;
      }
    }
    const aToken = new SmToken();
    aToken.eType = 'TBLANK';
    aToken.cMathChar = '';
    aToken.nGroup = TG.Blank;
    aToken.nLevel = 5;
    const pBlank = new SmNode(SmNodeType.Blank, aToken);
    if (nWide > 0) pBlank.IncreaseBy(aToken, nWide);
    if (nNarrow > 0) {
      aToken.eType = 'TSBLANK';
      pBlank.IncreaseBy(aToken, nNarrow);
    }
    this.GetSmImport().GetNodeStack().push(pBlank);
  }
}

class SmXMLSubContext_Impl extends SmXMLRowContext_Impl {
  protected GenericEndElement(eType: SmTokenType, eSubSup: number): void {
    /*The <msub> element requires exactly 2 arguments.*/
    const bNodeCheck = this.GetSmImport().GetNodeStack().length - this.nElementCount === 2;
    if (!bNodeCheck) return;

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = eType;
    const pNode = SubSupNode(aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();

    // initialize subnodes array
    const aSubNodes = new Array<SmNode | null>(1 + SUBSUP_NUM_ENTRIES).fill(null);

    aSubNodes[eSubSup + 1] = popOrZero(rNodeStack);
    aSubNodes[0] = popOrZero(rNodeStack);
    pNode.SetSubNodes(aSubNodes);
    rNodeStack.push(pNode);
  }

  override endFastElement(): void { this.GenericEndElement('TRSUB', RSUB); }
}

class SmXMLSupContext_Impl extends SmXMLSubContext_Impl {
  override endFastElement(): void { this.GenericEndElement('TRSUP', RSUP); }
}

class SmXMLSubSupContext_Impl extends SmXMLRowContext_Impl {
  protected GenericEndElement(eType: SmTokenType, aSub: number, aSup: number): void {
    /*The <msub> element requires exactly 3 arguments.*/
    const bNodeCheck = this.GetSmImport().GetNodeStack().length - this.nElementCount === 3;
    if (!bNodeCheck) return;

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = eType;
    const pNode = SubSupNode(aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();

    // initialize subnodes array
    const aSubNodes = new Array<SmNode | null>(1 + SUBSUP_NUM_ENTRIES).fill(null);

    aSubNodes[aSup + 1] = popOrZero(rNodeStack);
    aSubNodes[aSub + 1] = popOrZero(rNodeStack);
    aSubNodes[0] = popOrZero(rNodeStack);
    pNode.SetSubNodes(aSubNodes);
    rNodeStack.push(pNode);
  }

  override endFastElement(): void { this.GenericEndElement('TRSUB', RSUB, RSUP); }
}

class SmXMLUnderContext_Impl extends SmXMLSubContext_Impl {
  protected nAttrCount = 0;

  override startFastElement(xAttrList: Attr[]): void {
    this.nAttrCount = xAttrList.length;
  }

  HandleAccent(): void {
    const bNodeCheck = this.GetSmImport().GetNodeStack().length - this.nElementCount === 2;
    if (!bNodeCheck) return;

    /*Just one special case for the underline thing*/
    const rNodeStack = this.GetSmImport().GetNodeStack();
    const pTest = popOrZero(rNodeStack)!;
    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = 'TUNDERLINE';

    let pFirst: SmNode | null;
    const pNode = new SmNode(SmNodeType.Attribute, aToken);
    if ((char0(pTest.GetToken().cMathChar) & 0x0FFF) === 0x0332) pFirst = new SmNode(SmNodeType.Rectangle, aToken);
    else pFirst = pTest;

    const pSecond = popOrZero(rNodeStack);
    pNode.SetSubNodes(pFirst, pSecond);
    pNode.SetScaleMode(SmScaleMode.Width);
    rNodeStack.push(pNode);
  }

  override endFastElement(): void {
    if (!this.nAttrCount) this.GenericEndElement('TCSUB', CSUB);
    else this.HandleAccent();
  }
}

class SmXMLOverContext_Impl extends SmXMLSubContext_Impl {
  protected nAttrCount = 0;

  override endFastElement(): void {
    if (!this.nAttrCount) this.GenericEndElement('TCSUP', CSUP);
    else this.HandleAccent();
  }

  override startFastElement(xAttrList: Attr[]): void {
    this.nAttrCount = xAttrList.length;
  }

  HandleAccent(): void {
    const bNodeCheck = this.GetSmImport().GetNodeStack().length - this.nElementCount === 2;
    if (!bNodeCheck) return;

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = 'TACUTE';

    const pNode = new SmNode(SmNodeType.Attribute, aToken);
    const rNodeStack = this.GetSmImport().GetNodeStack();

    const pFirst = popOrZero(rNodeStack);
    const pSecond = popOrZero(rNodeStack);
    pNode.SetSubNodes(pFirst, pSecond);
    pNode.SetScaleMode(SmScaleMode.Width);
    rNodeStack.push(pNode);
  }
}

class SmXMLUnderOverContext_Impl extends SmXMLSubSupContext_Impl {
  override endFastElement(): void { this.GenericEndElement('TCSUB', CSUB, CSUP); }
}

class SmXMLMultiScriptsContext_Impl extends SmXMLSubSupContext_Impl {
  private bHasPrescripts = false;

  private ProcessSubSupPairs(bIsPrescript: boolean): void {
    const rNodeStack = this.GetSmImport().GetNodeStack();

    if (rNodeStack.length <= this.nElementCount) return;

    const nCount = rNodeStack.length - this.nElementCount - 1;
    if (nCount === 0) return;

    if (nCount % 2 === 0) {
      const aToken = new SmToken();
      aToken.cMathChar = '';
      aToken.eType = bIsPrescript ? 'TLSUB' : 'TRSUB';

      const aReverseStack: SmNode[] = [];
      for (let i = 0; i < nCount + 1; i++) {
        const pNode = rNodeStack.pop()!;
        aReverseStack.push(pNode);
      }

      const eSub = bIsPrescript ? LSUB : RSUB;
      const eSup = bIsPrescript ? LSUP : RSUP;

      for (let i = 0; i < nCount; i += 2) {
        const pNode = SubSupNode(aToken);

        // initialize subnodes array
        const aSubNodes = new Array<SmNode | null>(1 + SUBSUP_NUM_ENTRIES).fill(null);

        /*On each loop the base and its sub sup pair becomes the
         base for the next loop to which the next sub sup pair is
         attached, i.e. wheels within wheels*/
        aSubNodes[0] = popOrZero(aReverseStack);

        let pScriptNode = popOrZero(aReverseStack);

        if (pScriptNode && (pScriptNode.GetToken().eType !== 'TIDENT' || pScriptNode.GetToken().aText !== ''))
          aSubNodes[eSub + 1] = pScriptNode;
        pScriptNode = popOrZero(aReverseStack);
        if (pScriptNode && (pScriptNode.GetToken().eType !== 'TIDENT' || pScriptNode.GetToken().aText !== ''))
          aSubNodes[eSup + 1] = pScriptNode;

        pNode.SetSubNodes(aSubNodes);
        aReverseStack.push(pNode);
      }
      const pNode = aReverseStack.pop()!;
      rNodeStack.push(pNode);
    } else {
      // Ignore odd number of elements.
      for (let i = 0; i < nCount; i++) rNodeStack.pop();
    }
  }

  override endFastElement(): void {
    this.ProcessSubSupPairs(this.bHasPrescripts);
  }

  override createFastChildContext(nElement: string): SmXMLImportContext | null {
    let xContext: SmXMLImportContext | null;

    switch (nElement) {
      case 'mprescripts':
        this.bHasPrescripts = true;
        this.ProcessSubSupPairs(false);
        xContext = new SmXMLImportContext(this.GetSmImport()); // SmXMLPrescriptsContext_Impl
        break;
      case 'none':
        xContext = new SmXMLNoneContext_Impl(this.GetSmImport());
        break;
      default:
        xContext = super.createFastChildContext(nElement);
        break;
    }
    return xContext;
  }
}

class SmXMLNoneContext_Impl extends SmXMLImportContext {
  override endFastElement(): void {
    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.aText = '';
    aToken.nLevel = 5;
    aToken.eType = 'TIDENT';
    this.GetSmImport().GetNodeStack().push(new SmNode(SmNodeType.Text, aToken));
  }
}

class SmXMLTableRowContext_Impl extends SmXMLRowContext_Impl {
  override createFastChildContext(nElement: string): SmXMLImportContext | null {
    let xContext: SmXMLImportContext | null;

    switch (nElement) {
      case 'mtd':
        xContext = new SmXMLTableCellContext_Impl(this.GetSmImport());
        break;
      default:
        xContext = super.createFastChildContext(nElement);
        break;
    }
    return xContext;
  }
}

class SmXMLTableContext_Impl extends SmXMLTableRowContext_Impl {
  override endFastElement(): void {
    const rNodeStack = this.GetSmImport().GetNodeStack();
    const aReverseStack: SmNode[] = [];

    const nRows = rNodeStack.length - this.nElementCount;
    let nCols = 0;

    for (let i = nRows; i > 0; --i) {
      let pArray = rNodeStack.pop()!;
      if (pArray.GetNumSubNodes() === 0) {
        //This is a little tricky, it is possible that there was
        //be elements that were not inside a <mtd> pair, in which
        //case they will not be in a row, i.e. they will not have
        //SubNodes, so we have to wait until here before we can
        //resolve the situation. Implicit surrounding tags are
        //surprisingly difficult to get right within this
        //architecture

        const aDummy = new SmToken();
        const pExprNode = new SmNode(SmNodeType.Expression, aDummy);
        pExprNode.SetSubNodes([pArray]);
        pArray = pExprNode;
      }

      nCols = Math.max(nCols, pArray.GetNumSubNodes());
      aReverseStack.push(pArray);
    }
    const aExpressionArray = new Array<SmNode | null>(nCols * nRows).fill(null);
    let j = 0;
    for (let k = aReverseStack.length - 1; k >= 0; k--) {
      const xArray = aReverseStack[k]!;
      for (let i = 0; i < xArray.GetNumSubNodes(); ++i) aExpressionArray[j++] = xArray.GetSubNode(i);
      xArray.ClearSubNodes();
    }

    const aToken = new SmToken();
    aToken.cMathChar = '';
    aToken.eType = 'TMATRIX';
    const pSNode = new SmNode(SmNodeType.Matrix, aToken);
    pSNode.SetSubNodes(aExpressionArray);
    pSNode.SetRowCol(nRows, nCols);
    rNodeStack.push(pSNode);
  }

  override createFastChildContext(nElement: string): SmXMLImportContext | null {
    let xContext: SmXMLImportContext | null;

    switch (nElement) {
      case 'mtr':
        xContext = new SmXMLTableRowContext_Impl(this.GetSmImport());
        break;
      default:
        xContext = super.createFastChildContext(nElement);
        break;
    }
    return xContext;
  }
}

class SmXMLTableCellContext_Impl extends SmXMLRowContext_Impl {}

class SmXMLAlignGroupContext_Impl extends SmXMLRowContext_Impl {
  /*Don't do anything with alignment for now*/
}

class SmXMLActionContext_Impl extends SmXMLRowContext_Impl {
  private mnSelection = 1; // 1-based

  override startFastElement(xAttrList: Attr[]): void {
    for (const aIter of xAttrList) {
      switch (aIter.sName) {
        case 'selection': {
          const n = parseInt(aIter.sValue, 10) || 0;
          if (n > 0) this.mnSelection = n;
          break;
        }
        default:
          break;
      }
    }
  }

  override endFastElement(): void {
    const rNodeStack = this.GetSmImport().GetNodeStack();
    const nSize = rNodeStack.length;
    if (nSize <= this.nElementCount) {
      // not compliant to maction's specification, e.g., no subexpressions
      return;
    }
    if (nSize < this.nElementCount + this.mnSelection) {
      // No selected subexpression exists, which is a MathML error;
      // fallback to selecting the first
      this.mnSelection = 1;
    }
    for (let i = nSize - (this.nElementCount + this.mnSelection); i > 0; i--) rNodeStack.pop();
    const pSelected = rNodeStack.pop()!;
    for (let i = rNodeStack.length - this.nElementCount; i > 0; i--) rNodeStack.pop();
    rNodeStack.push(pSelected);
  }
}

// The SAX side: drive the contexts over the parsed element tree. Element names are matched in the
// MathML namespace only: unprefixed names (unless a default namespace other than MathML is
// declared) and prefixes declared for MathML, or the root's own prefix when the declaration lies
// outside the tree that was passed in.

function DriveContext(xContext: SmXMLImportContext, rElement: XmlElement, aNamespaces: Map<string, string>): void {
  let aNs = aNamespaces;
  const aAttrs: Attr[] = [];
  for (const [sQName, sValue] of rElement.attrs) {
    if (sQName === 'xmlns' || sQName.startsWith('xmlns:')) {
      if (aNs === aNamespaces) aNs = new Map(aNamespaces);
      aNs.set(sQName === 'xmlns' ? '' : sQName.slice(6), sValue);
      continue;
    }
    const i = sQName.indexOf(':');
    aAttrs.push({ sName: i < 0 ? sQName : null, sLocal: sQName.slice(i + 1), sValue });
  }
  xContext.startFastElement(aAttrs);
  let sChars = '';
  for (const aChild of rElement.children) {
    if (typeof aChild === 'string') {
      sChars += aChild;
      continue;
    }
    if (sChars) xContext.characters(sChars);
    sChars = '';
    const sName = MathMLLocalName(aChild, aNs);
    const xChild = sName === null ? null : xContext.createFastChildContext(sName);
    if (xChild) DriveContext(xChild, aChild, aNs);
  }
  if (sChars) xContext.characters(sChars);
  xContext.endFastElement();
}

/** The local name of an element in the MathML namespace, null for any other element. Looks at the
 *  element's own namespace declarations too. */
function MathMLLocalName(rElement: XmlElement, aNamespaces: Map<string, string>): string | null {
  const i = rElement.name.indexOf(':');
  const sPrefix = i < 0 ? '' : rElement.name.slice(0, i);
  const sOwn = rElement.attrs.get(sPrefix ? `xmlns:${sPrefix}` : 'xmlns');
  const sUri = sOwn ?? aNamespaces.get(sPrefix);
  if (sUri !== undefined ? sUri !== XML_NAMESPACE_MATH : sPrefix !== '') return null;
  return rElement.name.slice(i + 1);
}

function ImportMathMLElement(root: XmlElement, aNamespaces: Map<string, string>): string {
  const i = root.name.indexOf(':');
  const aNs = new Map(aNamespaces);
  // A prefixed root declared outside the passed tree: take its prefix for MathML.
  if (i > 0 && !aNs.has(root.name.slice(0, i)) && !root.attrs.has(`xmlns:${root.name.slice(0, i)}`))
    aNs.set(root.name.slice(0, i), XML_NAMESPACE_MATH);
  const rImport = new SmXMLImport();
  DriveContext(new SmXMLDocContext_Impl(rImport), root, aNs);
  return rImport.endDocument();
}

/** The StarMath command text of a MathML formula (`root` is the `math` element). */
export function ImportMathML(root: XmlElement): string {
  return ImportMathMLElement(root, new Map());
}

/** The StarMath command text of the first MathML `math` element in a document (an embedded
 *  formula's content.xml, or a bare MathML file); '' when there is none. */
export function ImportMathMLString(xml: string): string {
  const find = (e: XmlElement, aNs: Map<string, string>): string | null => {
    for (const c of childElements(e)) {
      if (c.name === 'math' || c.name.endsWith(':math')) return ImportMathMLElement(c, aNs);
      let aChildNs = aNs;
      for (const [k, v] of c.attrs) {
        if (k === 'xmlns' || k.startsWith('xmlns:')) {
          if (aChildNs === aNs) aChildNs = new Map(aNs);
          aChildNs.set(k === 'xmlns' ? '' : k.slice(6), v);
        }
      }
      const r = find(c, aChildNs);
      if (r !== null) return r;
    }
    return null;
  };
  return find(parseXml(xml), new Map()) ?? '';
}
